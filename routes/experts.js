const express = require('express');
const mongoose = require('mongoose');
const Expert = require('../models/Expert');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { auth, expertAuth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Get all experts (with filters) - Only show approved experts
router.get('/', async (req, res) => {
  console.log('GET /api/experts - Request headers:', req.headers.authorization, req.headers['x-auth-token']);
  console.log('MongoDB connection state:', mongoose.connection.readyState);

  try {
    const { category, search, minRate, maxRate, isOnline, page = 1, limit = 20 } = req.query;

    let query = { isApproved: true }; // Only show approved experts

    // Filter by category
    if (category) {
      query.categories = category;
    }

    // Filter by online status
    if (isOnline === 'true') {
      query.isOnline = true;
      query.isBusy = false; // Only show available experts
    }

    // Filter by rate
    if (minRate || maxRate) {
      query.tokensPerMinute = {};
      if (minRate) query.tokensPerMinute.$gte = parseInt(minRate);
      if (maxRate) query.tokensPerMinute.$lte = parseInt(maxRate);
    }

    const experts = await Expert.find(query)
      .populate({
        path: 'user',
        select: 'name email avatar country',
        match: { _id: { $exists: true } } // Only populate if user exists
      })
      .populate('categories', 'name slug icon')
      .sort({ isOnline: -1, isBusy: 1, rating: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Filter out experts where user populate failed
    const validExperts = Array.isArray(experts) ? experts.filter(expert => expert && expert.user !== null) : [];

    // Auto-clear stuck busy statuses (only if more than 5 minutes ago, limit to 5 at a time to avoid slowing down the API)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const stuckExperts = validExperts
      .filter(expert => expert.isBusy && expert.updatedAt < fiveMinutesAgo)
      .slice(0, 5); // Limit to 5 at a time
    
    if (stuckExperts.length > 0) {
      // Clear status in background without blocking the response
      setImmediate(async () => {
        for (const expert of stuckExperts) {
          try {
            console.log(`Auto-clearing stuck busy status for expert ${expert._id} in list`);
            expert.isBusy = false;
            expert.currentCallId = null;
            await expert.save();
          } catch (err) {
            console.error(`Failed to clear busy status for expert ${expert._id}:`, err);
          }
        }
      });
    }

    const total = await Expert.countDocuments(query);

    // Search by name if search query provided
    let filteredExperts = validExperts;
    if (search && typeof search === 'string') {
      const searchLower = search.toLowerCase();
      filteredExperts = validExperts.filter(expert => {
        // Defensive checks for populated user
        if (!expert || !expert.user || !expert.user.name) return false;

        // Check name, title, skills
        const nameMatch = expert.user.name.toLowerCase().includes(searchLower);
        const titleMatch = expert.title && typeof expert.title === 'string' && expert.title.toLowerCase().includes(searchLower);
        const skillsMatch = expert.skills && Array.isArray(expert.skills) &&
          expert.skills.some(skill => typeof skill === 'string' && skill.toLowerCase().includes(searchLower));

        return nameMatch || titleMatch || skillsMatch;
      });
    }

    // Ensure we always return a valid response
    res.status(200).json({
      success: true,
      experts: Array.isArray(filteredExperts) ? filteredExperts : [],
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page),
      total
    });
  } catch (error) {
    console.error('Get experts error:', error);
    res.status(500).json({
      success: false,
      experts: [],
      message: 'Failed to fetch experts',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Get online experts - Only approved and available
router.get('/online', async (req, res) => {
  try {
    const { category } = req.query;
    let query = { isOnline: true, isAvailable: true, isBusy: false, isApproved: true };

    if (category) {
      query.categories = category;
    }

    const experts = await Expert.find(query)
      .populate({
        path: 'user',
        select: 'name email avatar country',
        match: { _id: { $exists: true } }
      })
      .populate('categories', 'name slug icon')
      .sort({ rating: -1 });

    // Filter out experts where user populate failed
    const validExperts = experts.filter(expert => expert.user !== null);

    res.json(validExperts);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get experts by category
router.get('/by-category/:categoryId', async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { onlineOnly } = req.query;

    let query = { categories: categoryId };
    if (onlineOnly === 'true') {
      query.isOnline = true;
    }

    const experts = await Expert.find(query)
      .populate({
        path: 'user',
        select: 'name email avatar',
        match: { _id: { $exists: true } }
      })
      .populate('categories', 'name slug icon')
      .sort({ isOnline: -1, rating: -1 });

    // Filter out experts where user populate failed
    const validExperts = experts.filter(expert => expert.user !== null);

    res.json(validExperts);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get single expert by ID or username
router.get('/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    let expert;

    // Check if identifier is a valid MongoDB ObjectId
    const isObjectId = /^[0-9a-fA-F]{24}$/.test(identifier);

    if (isObjectId) {
      // Find by expert ID
      expert = await Expert.findById(identifier)
        .populate('user', 'name email avatar phone country username')
        .populate('categories', 'name slug icon');
    } else {
      // Find by username
      const user = await User.findOne({ username: identifier.toLowerCase() });
      if (user) {
        expert = await Expert.findOne({ user: user._id })
          .populate('user', 'name email avatar phone country username')
          .populate('categories', 'name slug icon');
      }
    }

    if (!expert) {
      return res.status(404).json({ message: 'Expert not found' });
    }

    // Auto-clear stuck busy status (if busy for more than 5 minutes)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (expert.isBusy && expert.updatedAt < fiveMinutesAgo) {
      console.log(`Auto-clearing stuck busy status for expert ${expert._id}`);
      expert.isBusy = false;
      expert.currentCallId = null;
      await expert.save();
    }

    // Get reviews from completed calls
    const Call = require('../models/Call');
    const reviews = await Call.find({
      expert: expert._id,
      status: 'completed',
      rating: { $exists: true, $ne: null },
      review: { $exists: true, $ne: null, $ne: '' }
    })
      .populate('caller', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(10);

    // Format reviews for frontend
    const formattedReviews = reviews.map(call => ({
      name: call.caller?.name || 'Anonymous',
      avatar: call.caller?.avatar,
      rating: call.rating,
      text: call.review,
      date: call.createdAt
    }));

    // Add reviews to expert object
    expert = expert.toObject();
    expert.reviews = formattedReviews;

    res.json(expert);
  } catch (error) {
    console.error('Get expert error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get expert by user ID
router.get('/user/:userId', auth, async (req, res) => {
  try {
    const expert = await Expert.findOne({ user: req.params.userId })
      .populate('user', 'name email avatar phone country')
      .populate('categories', 'name slug icon');

    if (!expert) {
      return res.status(404).json({ message: 'Expert not found' });
    }

    res.json(expert);
  } catch (error) {
    console.error('Get expert by user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update expert profile (expert only)
router.put('/profile', expertAuth, async (req, res) => {
  try {
    const { title, bio, categories, tokensPerMinute, experience, skills, languages, isAvailable, banner } = req.body;

    const expert = await Expert.findOne({ user: req.user._id });
    if (!expert) {
      return res.status(404).json({ message: 'Expert profile not found' });
    }

    if (title) expert.title = title;
    if (bio) expert.bio = bio;
    if (categories) expert.categories = categories;
    if (tokensPerMinute) expert.tokensPerMinute = tokensPerMinute;
    if (experience !== undefined) expert.experience = experience;
    if (skills) expert.skills = skills;
    if (languages) expert.languages = languages;
    if (isAvailable !== undefined) expert.isAvailable = isAvailable;
    if (banner !== undefined) expert.banner = banner;

    await expert.save();

    const updatedExpert = await Expert.findById(expert._id)
      .populate('user', 'name email avatar')
      .populate('categories', 'name slug icon');

    res.json(updatedExpert);
  } catch (error) {
    console.error('Update expert error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Toggle online status (expert only)
router.put('/toggle-online', expertAuth, async (req, res) => {
  try {
    const expert = await Expert.findOne({ user: req.user._id });
    if (!expert) {
      return res.status(404).json({ message: 'Expert profile not found' });
    }

    expert.isOnline = !expert.isOnline;

    // Clear busy status when toggling (safety measure)
    expert.isBusy = false;
    expert.currentCallId = null;

    await expert.save();

    res.json({ isOnline: expert.isOnline });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get expert online status (for socket server)
router.get('/status/:expertId', async (req, res) => {
  try {
    const { expertId } = req.params;
    const expert = await Expert.findById(expertId);

    if (!expert) {
      return res.status(404).json({ message: 'Expert not found' });
    }

    res.json({
      isOnline: expert.isOnline || false,
      isBusy: expert.isBusy || false
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Set online status (expert only)
router.put('/set-online', expertAuth, async (req, res) => {
  try {
    const { isOnline } = req.body;

    const expert = await Expert.findOne({ user: req.user._id });
    if (!expert) {
      return res.status(404).json({ message: 'Expert profile not found' });
    }

    expert.isOnline = isOnline;
    await expert.save();

    res.json({ isOnline: expert.isOnline });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Internal endpoint for socket server to set expert online status (no auth required)
router.put('/set-online-internal/:expertId', async (req, res) => {
  try {
    const { expertId } = req.params;
    const { isOnline, isBusy } = req.body;

    const expert = await Expert.findById(expertId);
    if (!expert) {
      return res.status(404).json({ message: 'Expert not found' });
    }

    if (isOnline !== undefined) expert.isOnline = isOnline;
    if (isBusy !== undefined) expert.isBusy = isBusy;
    await expert.save();

    res.json({ isOnline: expert.isOnline, isBusy: expert.isBusy });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Clear busy status (internal - GET for testing, PUT for production)
router.get('/clear-busy-internal/:expertId', async (req, res) => {
  try {
    const expert = await Expert.findById(req.params.expertId);
    if (!expert) {
      return res.status(404).json({ message: 'Expert not found' });
    }

    expert.isBusy = false;
    expert.currentCallId = null;
    await expert.save();

    res.json({ message: 'Busy status cleared', isBusy: expert.isBusy });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Force clear busy status for specific expert (debug)
router.post('/force-clear-busy/:expertId', async (req, res) => {
  try {
    const expert = await Expert.findById(req.params.expertId);
    if (!expert) {
      return res.status(404).json({ message: 'Expert not found' });
    }

    const wasBusy = expert.isBusy;
    expert.isBusy = false;
    expert.currentCallId = null;
    await expert.save();

    res.json({
      message: 'Busy status cleared',
      wasBusy,
      nowBusy: expert.isBusy
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Claim tokens (expert only)
router.post('/claim-tokens', expertAuth, async (req, res) => {
  try {
    const expert = await Expert.findOne({ user: req.user._id });
    if (!expert) {
      return res.status(404).json({ message: 'Expert profile not found' });
    }

    if (expert.unclaimedTokens <= 0) {
      return res.status(400).json({ message: 'No tokens to claim' });
    }

    const tokensToClaim = expert.unclaimedTokens;
    const user = await User.findById(req.user._id);
    const tokensBefore = user.tokens;

    // Transfer unclaimed tokens to user's token balance
    user.tokens += tokensToClaim;
    await user.save();

    // Update expert stats
    expert.tokensClaimed += tokensToClaim;
    expert.unclaimedTokens = 0;
    await expert.save();

    // Create transaction record
    const transaction = new Transaction({
      user: user._id,
      type: 'claim',
      tokens: tokensToClaim,
      description: 'Tokens claimed from expert earnings',
      tokensBefore,
      tokensAfter: user.tokens
    });
    await transaction.save();

    res.json({
      message: 'Tokens claimed successfully',
      tokensClaimed: tokensToClaim,
      newTokenBalance: user.tokens,
      transaction
    });
  } catch (error) {
    console.error('Claim tokens error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get expert earnings stats (expert only)
router.get('/earnings', expertAuth, async (req, res) => {
  try {
    const expert = await Expert.findOne({ user: req.user._id });
    if (!expert) {
      // Return empty data instead of error for better UX
      return res.json({
        tokensEarned: 0,
        tokensClaimed: 0,
        unclaimedTokens: 0,
        totalCalls: 0,
        totalMinutes: 0
      });
    }

    res.json({
      tokensEarned: expert.tokensEarned || 0,
      tokensClaimed: expert.tokensClaimed || 0,
      unclaimedTokens: expert.unclaimedTokens || 0,
      totalCalls: expert.totalCalls || 0,
      totalMinutes: expert.totalMinutes || 0
    });
  } catch (error) {
    console.error('Earnings fetch error:', error);
    // Return empty data on error instead of failing
    res.json({
      tokensEarned: 0,
      tokensClaimed: 0,
      unclaimedTokens: 0,
      totalCalls: 0,
      totalMinutes: 0
    });
  }
});

// ===================
// ADMIN ROUTES
// ===================

// Get all experts for admin management
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const experts = await Expert.find()
      .populate('user', 'name email avatar')
      .populate('categories', 'name slug icon')
      .populate('approvedBy', 'name email')
      .sort({ createdAt: -1 });

    res.json(experts);
  } catch (error) {
    console.error('Admin get experts error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get pending experts (not approved yet)
router.get('/admin/pending', adminAuth, async (req, res) => {
  try {
    const pendingExperts = await Expert.find({ isApproved: false })
      .populate('user', 'name email avatar country phone')
      .populate('categories', 'name slug icon')
      .sort({ createdAt: -1 });

    res.json(pendingExperts);
  } catch (error) {
    console.error('Get pending experts error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Approve expert (admin only)
router.put('/admin/:id/approve', adminAuth, async (req, res) => {
  try {
    const expert = await Expert.findById(req.params.id)
      .populate('user', 'name email avatar')
      .populate('categories', 'name slug icon');

    if (!expert) {
      return res.status(404).json({ message: 'Expert not found' });
    }

    expert.isApproved = true;
    expert.approvedBy = req.user._id;
    expert.approvedAt = new Date();
    expert.rejectionReason = '';
    await expert.save();

    res.json({
      message: 'Expert approved successfully',
      expert
    });
  } catch (error) {
    console.error('Approve expert error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reject expert (admin only)
router.put('/admin/:id/reject', adminAuth, async (req, res) => {
  try {
    const { reason } = req.body;
    const expert = await Expert.findById(req.params.id)
      .populate('user', 'name email avatar')
      .populate('categories', 'name slug icon');

    if (!expert) {
      return res.status(404).json({ message: 'Expert not found' });
    }

    expert.isApproved = false;
    expert.rejectionReason = reason || 'Not specified';
    await expert.save();

    res.json({
      message: 'Expert rejected',
      expert
    });
  } catch (error) {
    console.error('Reject expert error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Toggle expert verification (admin only)
router.put('/admin/:id/verify', adminAuth, async (req, res) => {
  try {
    const expert = await Expert.findById(req.params.id)
      .populate('user', 'name email avatar')
      .populate('categories', 'name slug icon');

    if (!expert) {
      return res.status(404).json({ message: 'Expert not found' });
    }

    expert.isVerified = !expert.isVerified;
    await expert.save();

    res.json({
      message: `Expert ${expert.isVerified ? 'verified' : 'unverified'} successfully`,
      expert
    });
  } catch (error) {
    console.error('Toggle verification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete expert (admin only)
router.delete('/admin/:id', adminAuth, async (req, res) => {
  try {
    const expert = await Expert.findById(req.params.id);

    if (!expert) {
      return res.status(404).json({ message: 'Expert not found' });
    }

    // Update the user role back to 'user'
    await User.findByIdAndUpdate(expert.user, { role: 'user' });

    // Delete the expert profile
    await Expert.findByIdAndDelete(req.params.id);

    res.json({ message: 'Expert profile deleted successfully' });
  } catch (error) {
    console.error('Delete expert error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Reset expert busy status (admin only) - for fixing stuck experts
router.put('/admin/:id/reset-status', adminAuth, async (req, res) => {
  try {
    const expert = await Expert.findById(req.params.id)
      .populate('user', 'name email avatar');

    if (!expert) {
      return res.status(404).json({ message: 'Expert not found' });
    }

    // Reset busy status and clear current call
    expert.isBusy = false;
    expert.currentCallId = null;
    await expert.save();

    res.json({
      message: 'Expert status reset successfully',
      expert: {
        _id: expert._id,
        isBusy: expert.isBusy,
        currentCallId: expert.currentCallId,
        user: expert.user
      }
    });
  } catch (error) {
    console.error('Reset expert status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Sync expert busy status with socket server (admin only)
router.post('/admin/sync-busy-status', adminAuth, async (req, res) => {
  try {
    // Get active calls from socket server
    const socketServerUrl = process.env.SOCKET_SERVER_URL || 'https://consultoncall-socket-server.onrender.com';

    let activeCalls = [];
    try {
      const response = await fetch(`${socketServerUrl}/active-calls`);
      const data = await response.json();
      activeCalls = data.activeCalls || [];
    } catch (socketError) {
      console.error('Failed to fetch active calls from socket server:', socketError);
      return res.status(500).json({
        success: false,
        message: 'Failed to connect to socket server'
      });
    }

    // Get all experts from database
    const allExperts = await Expert.find({});

    // Create set of experts who are actually in calls
    const busyExpertIds = new Set(activeCalls.map(call => call.expertId));

    // Update database to match socket server state
    const updatePromises = allExperts.map(async (expert) => {
      const shouldBeBusy = busyExpertIds.has(expert._id.toString());

      if (expert.isBusy !== shouldBeBusy) {
        expert.isBusy = shouldBeBusy;
        if (!shouldBeBusy) {
          expert.currentCallId = null; // Clear call ID if not busy
        }
        await expert.save();
        return {
          expertId: expert._id,
          name: expert.user?.name || 'Unknown',
          wasBusy: !shouldBeBusy,
          nowBusy: shouldBeBusy
        };
      }
      return null;
    });

    const updates = (await Promise.all(updatePromises)).filter(update => update !== null);

    res.json({
      success: true,
      message: 'Expert busy status synced with socket server',
      activeCallsCount: activeCalls.length,
      busyExpertsCount: busyExpertIds.size,
      updates: updates,
      totalExperts: allExperts.length
    });
  } catch (error) {
    console.error('Sync busy status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync busy status',
      error: error.message
    });
  }
});

// HEARTBEAT ENDPOINT: Sync expert online status with socket server
// NOTE: This endpoint now only logs discrepancies but does NOT automatically mark experts offline
// Expert status is only controlled by their toggle button and disconnect events
router.post('/sync-online-status', async (req, res) => {
  try {
    const { onlineExpertIds, timestamp } = req.body;

    if (!Array.isArray(onlineExpertIds)) {
      return res.status(400).json({
        success: false,
        message: 'onlineExpertIds must be an array'
      });
    }

    // Find all experts marked as online in DB
    const dbOnlineExperts = await Expert.find({
      $or: [{ isOnline: true }, { isBusy: true }]
    }).select('_id isOnline isBusy currentCallId');

    // Log discrepancies but DON'T automatically mark offline
    // Expert status should only be controlled by toggle button and disconnect
    const discrepancies = [];

    for (const expert of dbOnlineExperts) {
      const expertIdStr = expert._id.toString();

      // If expert is in DB as online but not in socket server's list
      if (!onlineExpertIds.includes(expertIdStr)) {
        discrepancies.push({
          expertId: expertIdStr,
          dbStatus: { isOnline: expert.isOnline, isBusy: expert.isBusy },
          socketStatus: 'not_connected'
        });
      }
    }

    // Log the discrepancies for monitoring but don't fix them
    if (discrepancies.length > 0) {
      console.log(`Heartbeat: Found ${discrepancies.length} experts online in DB but not connected to socket:`);
      discrepancies.forEach(d => console.log(`  - Expert ${d.expertId}: DB=${JSON.stringify(d.dbStatus)}, Socket=disconnected`));
    }

    res.json({
      success: true,
      checked: dbOnlineExperts.length,
      discrepancies: discrepancies.length,
      loggedDiscrepancies: discrepancies,
      timestamp,
      note: 'Expert status is now only controlled by toggle button and disconnect events'
    });

  } catch (error) {
    console.error('Sync online status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync online status',
      error: error.message
    });
  }
});

// Update expert status (expert or admin)
router.put('/:id/status', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { isOnline, isBusy, isAvailable } = req.body;

    // Find the expert
    const expert = await Expert.findById(id);
    if (!expert) {
      return res.status(404).json({
        success: false,
        message: 'Expert not found'
      });
    }

    // Check permissions: expert can only update their own status, admin can update any     
    if (req.user.role !== 'admin' && expert.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this expert status'
      });
    }

    // Update status fields if provided
    if (isOnline !== undefined) expert.isOnline = isOnline;
    if (isBusy !== undefined) expert.isBusy = isBusy;
    if (isAvailable !== undefined) expert.isAvailable = isAvailable;

    await expert.save();

    // Populate user data for response
    const updatedExpert = await Expert.findById(id)
      .populate('user', 'name email avatar')
      .populate('categories', 'name slug icon');

    res.json({
      success: true,
      message: 'Expert status updated successfully',
      expert: updatedExpert
    });

  } catch (error) {
    console.error('Update expert status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update expert status',
      error: error.message
    });
  }
});

// HEARTBEAT ENDPOINT: Sync expert online status with socket server
router.post('/sync-online-status', async (req, res) => {
  try {
    const { onlineExpertIds, timestamp } = req.body;

    // Check which experts are in DB but not actually connected
    const offlineExperts = [];

    for (const expert of dbOnlineExperts) {
      const expertIdStr = expert._id.toString();

      // If expert is in DB as online but not in socket server's list
      if (!onlineExpertIds.includes(expertIdStr)) {
        // Mark them offline and not busy
        expert.isOnline = false;
        expert.isBusy = false;
        expert.currentCallId = null;
        await expert.save();

        offlineExperts.push(expertIdStr);
      }
    }

    res.json({
      success: true,
      checked: dbOnlineExperts.length,
      corrected: offlineExperts.length,
      offlineExperts,
      timestamp
    });

  } catch (error) {
    console.error('Sync online status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sync online status',
      error: error.message
    });
  }
});

module.exports = router;
