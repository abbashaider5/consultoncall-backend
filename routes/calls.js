const express = require('express');
const Call = require('../models/Call');
const Expert = require('../models/Expert');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth } = require('../middleware/auth');
const { callInitiationLimiter } = require('../middleware/rateLimiter');
const { CallStateManager, CALL_STATES } = require('../services/callStateManager');

const router = express.Router();

// Initiate a call - BACKEND IS SOURCE OF TRUTH (with rate limiting)
router.post('/initiate', auth, callInitiationLimiter, async (req, res) => {
  try {
    const { expertId } = req.body;

    if (!expertId) {
      return res.status(400).json({ success: false, message: 'Expert ID is required' });
    }

    // Check blockage
    const caller = await User.findById(req.user._id);
    // Expert model has 'user' field which is the User ID.
    // However, expertId passed here is likely the Expert document ID.
    const expertDoc = await Expert.findById(expertId);
    if (!expertDoc) {
      return res.status(404).json({ success: false, message: 'Expert not found' });
    }
    const expertUser = await User.findById(expertDoc.user);
    if (!expertUser) {
      return res.status(404).json({ success: false, message: 'Expert user not found' });
    }

    if (caller.blockedUsers && caller.blockedUsers.includes(expertUser._id)) {
      return res.status(403).json({ success: false, message: 'You have blocked this expert' });
    }
    if (expertUser.blockedUsers && expertUser.blockedUsers.includes(caller._id)) {
      return res.status(403).json({ success: false, message: 'You are blocked by this expert' });
    }

    // Use state manager to initiate call
    const result = await CallStateManager.initiateCall(req.user._id, expertId);

    res.json({
      success: true,
      message: 'Call initiated',
      call: {
        id: result.callId,
        expertId,
        expertName: result.expertName,
        tokensPerMinute: result.tokensPerMinute
      }
    });
  } catch (error) {
    console.error('Initiate call error:', error);
    res.status(400).json({ success: false, message: error.message || 'Failed to initiate call' });
  }
});

// Set call to RINGING state (called by socket server - no auth required)
router.put('/ringing/:callId', async (req, res) => {
  try {
    await CallStateManager.setRinging(req.params.callId);
    res.json({ success: true, message: 'Call ringing' });
  } catch (error) {
    console.error('Set ringing error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Get active call for current user (for UI restoration on refresh)
router.get('/active', auth, async (req, res) => {
  try {
    // First, clean up any stuck calls
    const now = new Date();
    const thirtySecondsAgo = new Date(now.getTime() - 30 * 1000);
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    // Mark old ringing calls as missed
    await Call.updateMany(
      {
        status: 'ringing',
        createdAt: { $lt: thirtySecondsAgo }
      },
      { status: 'missed', endTime: now }
    );

    // Mark old accepted calls as failed (should have connected by now)
    await Call.updateMany(
      {
        status: 'accepted',
        updatedAt: { $lt: thirtySecondsAgo }
      },
      { status: 'failed', endTime: now }
    );

    // Mark very old connected calls as failed (in case of disconnect)
    await Call.updateMany(
      {
        status: 'connected',
        updatedAt: { $lt: fiveMinutesAgo }
      },
      { status: 'failed', endTime: now }
    );

    const activeCall = await Call.findOne({
      $or: [
        { caller: req.user._id },
        { expert: req.user._id }
      ],
      status: { $in: ['ringing', 'accepted', 'connected'] }
    }).populate('caller', 'name avatar').populate('expert', 'user');

    if (!activeCall) {
      return res.json({ success: true, call: null });
    }

    res.json({
      success: true,
      call: {
        id: activeCall._id,
        callerId: activeCall.caller._id,
        expertId: activeCall.expert._id,
        status: activeCall.status,
        startTime: activeCall.startTime,
        caller: activeCall.caller,
        expert: activeCall.expert
      }
    });
  } catch (error) {
    console.error('Get active call error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Expert accepts call
router.put('/accept/:callId', auth, async (req, res) => {
  try {
    // Find expert by user ID
    const expert = await Expert.findOne({ user: req.user._id });
    if (!expert) {
      return res.status(403).json({ success: false, message: 'Not an expert' });
    }

    const result = await CallStateManager.acceptCall(req.params.callId, expert._id);
    res.json({ success: true, message: 'Call accepted', call: result });
  } catch (error) {
    console.error('Accept call error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Expert rejects call
router.put('/reject/:callId', auth, async (req, res) => {
  try {
    const { reason } = req.body;

    // Find expert by user ID
    const expert = await Expert.findOne({ user: req.user._id });
    if (!expert) {
      return res.status(403).json({ success: false, message: 'Not an expert' });
    }

    const result = await CallStateManager.rejectCall(req.params.callId, expert._id, reason);
    res.json({ success: true, message: 'Call rejected', reason: result.reason });
  } catch (error) {
    console.error('Reject call error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Call connected - START BILLING
router.put('/connect/:callId', auth, async (req, res) => {
  try {
    const result = await CallStateManager.connectCall(req.params.callId);
    res.json({
      success: true,
      message: 'Call connected',
      startTime: result.startTime
    });
  } catch (error) {
    console.error('Connect call error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// End call - CALCULATE BILLING
router.put('/end/:callId', auth, async (req, res) => {
  try {
    const { initiatedBy } = req.body;
    const result = await CallStateManager.endCall(req.params.callId, initiatedBy);

    res.json({
      success: true,
      message: 'Call ended',
      call: {
        id: req.params.callId,
        duration: result.duration,
        minutes: result.minutes,
        tokensSpent: result.tokensSpent,
        expertTokens: result.expertTokens
      },
      newBalance: result.callerBalance
    });
  } catch (error) {
    console.error('End call error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Handle disconnect during call
router.put('/disconnect/:callId', auth, async (req, res) => {
  try {
    const { userType } = req.body;
    const result = await CallStateManager.handleDisconnect(
      req.params.callId,
      req.user._id,
      userType
    );

    res.json({ success: true, message: 'Disconnect handled' });
  } catch (error) {
    console.error('Handle disconnect error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Get call state
router.get('/state/:callId', auth, async (req, res) => {
  try {
    const state = await CallStateManager.getCallState(req.params.callId);

    if (!state) {
      return res.status(404).json({ success: false, message: 'Call not found' });
    }

    res.json({ success: true, call: state });
  } catch (error) {
    console.error('Get call state error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});


// Check wallet balance during call (for real-time monitoring with warnings)
router.get('/check-balance/:callId', auth, async (req, res) => {
  try {
    // Use CallStateManager's checkBalance function
    const result = await CallStateManager.checkBalance(req.params.callId);
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Check balance error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update call status (missed/rejected/failed)
router.put('/status/:callId', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = [CALL_STATES.MISSED, CALL_STATES.REJECTED, CALL_STATES.FAILED];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }

    const call = await Call.findById(req.params.callId).populate('expert');

    if (!call) {
      return res.status(404).json({ success: false, message: 'Call not found' });
    }

    // If call is being marked as failed/missed/rejected, release expert
    if (call.expert) {
      await CallStateManager.releaseExpert(call.expert._id);
    }

    await CallStateManager.transitionState(req.params.callId, status);

    res.json({ success: true, message: 'Call status updated' });
  } catch (error) {
    console.error('Update status error:', error);
    res.status(400).json({ success: false, message: error.message });
  }
});

// Rate a call
router.put('/rate/:callId', auth, async (req, res) => {
  try {
    const { rating, review } = req.body;

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'Rating must be between 1 and 5' });
    }

    const call = await Call.findById(req.params.callId);

    if (!call) {
      return res.status(404).json({ message: 'Call not found' });
    }

    if (call.caller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to rate this call' });
    }

    call.rating = rating;
    call.review = review;
    await call.save();

    // Update expert's average rating and satisfied customers
    const expert = await Expert.findById(call.expert);
    const allCalls = await Call.find({
      expert: expert._id,
      rating: { $exists: true, $ne: null }
    });

    const totalRating = allCalls.reduce((sum, c) => sum + c.rating, 0);
    expert.rating = allCalls.length > 0 ? (totalRating / allCalls.length).toFixed(1) : 0;
    expert.totalRatings = allCalls.length;
    expert.satisfiedCustomers = allCalls.filter(c => c.rating >= 4).length;
    await expert.save();

    res.json({ message: 'Rating submitted', call });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user's call history
router.get('/history', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    // Defensive: ensure user exists
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: 'User not authenticated', calls: [], totalPages: 0, currentPage: 1 });
    }

    const calls = await Call.find({ caller: req.user._id })
      .populate({
        path: 'expert',
        populate: { path: 'user', select: 'name avatar' }
      })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean(); // Use lean for better performance

    // Filter out calls with null experts
    const validCalls = (calls || []).filter(call => call && call.expert);

    const total = await Call.countDocuments({ caller: req.user._id });

    res.json({
      success: true,
      calls: validCalls,
      totalPages: Math.ceil(total / limit) || 1,
      currentPage: parseInt(page)
    });
  } catch (error) {
    console.error('Get call history error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch call history', calls: [], totalPages: 0, currentPage: 1 });
  }
});

// Get expert's call history
router.get('/expert-history', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    // Defensive: ensure user exists
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: 'User not authenticated', calls: [], totalPages: 0, currentPage: 1 });
    }

    const expert = await Expert.findOne({ user: req.user._id });
    if (!expert) {
      // Return empty array instead of 404 for better UX
      return res.json({ success: true, calls: [], totalPages: 0, currentPage: 1 });
    }

    const calls = await Call.find({ expert: expert._id })
      .populate('caller', 'name avatar')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .lean();

    // Filter out calls with null callers
    const validCalls = (calls || []).filter(call => call && call.caller);

    const total = await Call.countDocuments({ expert: expert._id });

    res.json({
      success: true,
      calls: validCalls,
      totalPages: Math.ceil(total / limit) || 1,
      currentPage: parseInt(page)
    });
  } catch (error) {
    console.error('Get expert call history error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch call history', calls: [], totalPages: 0, currentPage: 1 });
  }
});

// HEARTBEAT ENDPOINT: Sync active calls with socket server
router.post('/sync-active-calls', async (req, res) => {
  try {
    const { activeCallIds, timestamp } = req.body;

    if (!Array.isArray(activeCallIds)) {
      return res.status(400).json({
        success: false,
        message: 'activeCallIds must be an array'
      });
    }

    // Find all calls in DB that are in progress
    const dbActiveCalls = await Call.find({
      status: { $in: ['pending', 'ringing', 'connected'] }
    }).select('_id status expert');

    // Check which calls are in DB but not actually active in socket server
    const cleanedCalls = [];

    for (const call of dbActiveCalls) {
      const callIdStr = call._id.toString();

      // If call is in DB as active but not in socket server's list
      if (!activeCallIds.includes(callIdStr)) {
        // Mark call as failed/timeout
        call.status = 'failed';
        call.endTime = new Date();
        await call.save();

        // Also clear expert busy status
        if (call.expert) {
          await Expert.findByIdAndUpdate(call.expert, {
            isBusy: false,
            currentCallId: null
          });
        }

        cleanedCalls.push(callIdStr);
      }
    }

    res.json({
      success: true,
      checked: dbActiveCalls.length,
      cleaned: cleanedCalls.length,
      cleanedCalls,
      timestamp
    });

  } catch (error) {
    console.error('Sync active calls error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync active calls',
      error: error.message
    });
  }
});

// INTERNAL: End call (called by socket server on disconnect)
router.post('/internal/end-call/:callId', async (req, res) => {
  try {
    const { reason = 'system_disconnect' } = req.body;

    const call = await Call.findById(req.params.callId)
      .populate('caller')
      .populate({
        path: 'expert',
        populate: { path: 'user' }
      });

    if (!call) {
      return res.status(404).json({ message: 'Call not found' });
    }

    // Idempotency check: If already completed, just return details
    if (call.status === 'completed' || call.status === 'failed' || call.status === 'missed') {
      return res.json({
        success: true,
        message: 'Call already ended',
        call: {
          id: call._id,
          status: call.status,
          duration: call.duration,
          tokensSpent: call.tokensSpent
        }
      });
    }

    if (call.status !== 'ongoing' && call.status !== 'connected') {
      // If it was ringing or initiating, just mark as failed/missed
      call.status = 'failed';
      call.endTime = new Date();
      await call.save();

      // Release expert
      if (call.expert) {
        await Expert.findByIdAndUpdate(call.expert._id, {
          isBusy: false,
          currentCallId: null
        });
      }

      return res.json({ success: true, message: 'Call marked as failed' });
    }

    // Mark expert as not busy
    const expert = await Expert.findById(call.expert._id);
    if (expert) {
      expert.isBusy = false;
      expert.currentCallId = null;
    }

    // Calculate duration and tokens spent
    call.endTime = new Date();
    // Ensure we have a valid start time, otherwise default to now (0 duration)
    const startTime = call.startTime || call.createdAt;
    call.duration = Math.floor((call.endTime - startTime) / 1000); // Duration in seconds
    call.status = 'completed';

    // Calculate tokens spent (minimum 1 minute, round up)
    const minutes = Math.max(1, Math.ceil(call.duration / 60));
    call.tokensSpent = minutes * call.tokensPerMinute;

    await call.save();

    // Deduct tokens from caller
    const caller = await User.findById(call.caller._id);
    if (caller) {
      const callerTokensBefore = caller.tokens;

      // Check if caller has enough tokens
      if (caller.tokens < call.tokensSpent) {
        call.tokensSpent = caller.tokens; // Deduct only what's available
      }

      caller.tokens -= call.tokensSpent;
      if (caller.tokens < 0) caller.tokens = 0;
      await caller.save();

      // Create transaction for caller (debit)
      const callerTransaction = new Transaction({
        user: caller._id,
        type: 'debit',
        tokens: call.tokensSpent,
        description: `Call with ${call.expert.user.name} (${minutes} min) - ${reason}`,
        call: call._id,
        tokensBefore: callerTokensBefore,
        tokensAfter: caller.tokens
      });
      await callerTransaction.save();
    }

    // Add tokens to expert's unclaimed tokens (expert gets 90%)
    if (expert) {
      const expertTokens = Math.floor(call.tokensSpent * 0.9);

      // Update expert stats
      expert.totalCalls = (expert.totalCalls || 0) + 1;
      expert.totalMinutes = (expert.totalMinutes || 0) + minutes;
      expert.tokensEarned = (expert.tokensEarned || 0) + expertTokens;
      expert.unclaimedTokens = (expert.unclaimedTokens || 0) + expertTokens;
      await expert.save();
    }

    res.json({
      success: true,
      message: 'Call ended by system',
      call: {
        id: call._id,
        duration: call.duration,
        minutes: minutes,
        tokensSpent: call.tokensSpent
      }
    });
  } catch (error) {
    console.error('Internal end call error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
