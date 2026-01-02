/**
 * Call State Manager - Single Source of Truth for Call State
 * Implements strict state machine for call lifecycle
 */

const Call = require('../models/Call');
const User = require('../models/User');
const Expert = require('../models/Expert');
const Transaction = require('../models/Transaction');
const expertStatusManager = require('./expertStatusManager');
const isExpertAvailable = expertStatusManager.isExpertAvailable;
const setExpertBusy = expertStatusManager.setExpertBusy;
const releaseExpertStatus = expertStatusManager.releaseExpert;

// Call states - STRICT transitions only
const CALL_STATES = {
  INITIATED: 'initiated',
  RINGING: 'ringing',
  ACCEPTED: 'accepted',
  CONNECTED: 'ongoing', // Match Call model enum
  ENDED: 'completed',   // Match Call model enum
  MISSED: 'missed',
  REJECTED: 'rejected',
  FAILED: 'failed'
};

// Valid state transitions
const VALID_TRANSITIONS = {
  [CALL_STATES.INITIATED]: [CALL_STATES.RINGING, CALL_STATES.FAILED],
  [CALL_STATES.RINGING]: [CALL_STATES.ACCEPTED, CALL_STATES.REJECTED, CALL_STATES.MISSED, CALL_STATES.FAILED],
  [CALL_STATES.ACCEPTED]: [CALL_STATES.CONNECTED, CALL_STATES.FAILED, CALL_STATES.ENDED],
  [CALL_STATES.CONNECTED]: [CALL_STATES.ENDED],
  // Terminal states (no transitions out)
  [CALL_STATES.ENDED]: [],
  [CALL_STATES.MISSED]: [],
  [CALL_STATES.REJECTED]: [],
  [CALL_STATES.FAILED]: []
};

class CallStateManager {
  /**
   * Initialize a new call session
   */
  static async initiateCall(userId, expertId) {
    try {
      // Validate user
      const user = await User.findById(userId);
      if (!user) {
        const error = new Error('User not found');
        error.code = 'USER_NOT_FOUND';
        throw error;
      }

      // Validate expert
      const expert = await Expert.findById(expertId).populate('user');
      if (!expert) {
        const error = new Error('Expert not found');
        error.code = 'EXPERT_NOT_FOUND';
        throw error;
      }

      if (!expert.isApproved) {
        const error = new Error('Expert is not approved');
        error.code = 'EXPERT_NOT_APPROVED';
        throw error;
      }

      // Enforce expert availability at initiation time (using status manager)
      const available = await isExpertAvailable(expertId);
      if (!available) {
        const error = new Error('Expert is currently offline or busy. Please try again later.');
        error.code = 'EXPERT_UNAVAILABLE';
        throw error;
      }

      // Check minimum balance (5 minutes worth)
      const minimumTokens = expert.tokensPerMinute * 5;
      if (user.tokens < minimumTokens) {
        const error = new Error(`Insufficient balance. Minimum ₹${minimumTokens} required`);
        error.code = 'INSUFFICIENT_BALANCE';
        throw error;
      }

      // Create call with INITIATED state
      const call = new Call({
        caller: userId,
        expert: expertId,
        status: CALL_STATES.INITIATED,
        tokensPerMinute: expert.tokensPerMinute,
        createdAt: new Date()
      });

      await call.save();

      return {
        success: true,
        callId: call._id,
        expertName: expert.user?.name || 'Expert',
        tokensPerMinute: expert.tokensPerMinute
      };
    } catch (error) {
      console.error('CallStateManager.initiateCall error:', error);
      error.code = error.code || 'CALL_INIT_FAILED';
      throw error;
    }
  }

  /**
   * Transition call to RINGING state
   */
  static async setRinging(callId) {
    try {
      const result = await this.transitionState(callId, CALL_STATES.RINGING);
      
      // Set expert busy when call starts ringing (using status manager)
      const call = await Call.findById(callId);
      if (call && call.expert) {
        await setExpertBusy(call.expert, true, callId);
      }
      
      return result;
    } catch (error) {
      // On failure, ensure expert is released
      try {
        const call = await Call.findById(callId);
        if (call) {
          await releaseExpertStatus(call.expert);
          call.status = CALL_STATES.FAILED;
          await call.save();
        }
      } catch (cleanupError) {
        console.error('Cleanup error in setRinging:', cleanupError);
      }
      throw error;
    }
  }

  /**
   * Expert accepts call - transition to ACCEPTED
   */
  static async acceptCall(callId, expertId) {
    try {
      const call = await Call.findById(callId).populate('expert');
      if (!call) {
        throw new Error('Call not found');
      }

      // Verify expert owns this call
      if (call.expert._id.toString() !== expertId.toString()) {
        throw new Error('Unauthorized');
      }

      // Transition to accepted
      await this.transitionState(callId, CALL_STATES.ACCEPTED);

      return { success: true, callId };
    } catch (error) {
      console.error('CallStateManager.acceptCall error:', error);
      throw error;
    }
  }

  /**
   * Expert rejects call - transition to REJECTED
   */
  static async rejectCall(callId, expertId, reason = 'Expert declined') {
    try {
      const call = await Call.findById(callId).populate('expert');
      if (!call) {
        throw new Error('Call not found');
      }

      // Verify expert owns this call
      if (call.expert._id.toString() !== expertId.toString()) {
        throw new Error('Unauthorized');
      }

      // Transition to rejected
      await this.transitionState(callId, CALL_STATES.REJECTED);

      // Release expert
      await this.releaseExpert(call.expert._id);

      return { success: true, reason };
    } catch (error) {
      console.error('CallStateManager.rejectCall error:', error);
      throw error;
    }
  }

  /**
   * Call connected - transition to CONNECTED and start billing
   */
  static async connectCall(callId) {
    try {
      const call = await Call.findById(callId);
      if (!call) {
        throw new Error('Call not found');
      }

      // Transition to connected
      call.status = CALL_STATES.CONNECTED;
      call.startTime = new Date();
      await call.save();

      return {
        success: true,
        callId,
        startTime: call.startTime
      };
    } catch (error) {
      console.error('CallStateManager.connectCall error:', error);
      throw error;
    }
  }

  /**
   * Check user balance during active call
   * Returns warning if balance is low
   */
  static async checkBalance(callId) {
    try {
      const call = await Call.findById(callId)
        .populate('caller')
        .populate('expert');

      if (!call || call.status !== CALL_STATES.CONNECTED) {
        return {
          shouldEnd: false,
          warning: null,
          balance: 0
        };
      }

      const user = await User.findById(call.caller._id);
      if (!user) {
        return {
          shouldEnd: true,
          warning: 'User not found',
          balance: 0
        };
      }

      // Calculate current duration
      const now = new Date();
      const durationSeconds = Math.floor((now - call.startTime) / 1000);
      const currentMinutes = Math.ceil(durationSeconds / 60);
      const currentCost = currentMinutes * call.tokensPerMinute;

      // Calculate remaining minutes
      const remainingTokens = user.tokens;
      const remainingMinutes = Math.floor(remainingTokens / call.tokensPerMinute);

      // Determine warnings
      let warning = null;
      if (remainingTokens < call.tokensPerMinute) {
        warning = 'LOW_BALANCE_CRITICAL'; // Less than 1 minute
      } else if (remainingTokens < call.tokensPerMinute * 2) {
        warning = 'LOW_BALANCE_1MIN'; // Less than 2 minutes
      } else if (remainingTokens < call.tokensPerMinute * 3) {
        warning = 'LOW_BALANCE_2MIN'; // Less than 3 minutes
      }

      return {
        shouldEnd: remainingTokens < call.tokensPerMinute,
        warning,
        balance: user.tokens,
        remainingMinutes,
        currentMinutes,
        costPerMinute: call.tokensPerMinute
      };
    } catch (error) {
      console.error('CallStateManager.checkBalance error:', error);
      throw error;
    }
  }

  /**
   * End call - calculate billing, update balances with concurrency control
   * This is the SINGLE SOURCE OF TRUTH for billing
   */
  static async endCall(callId, initiatedBy = 'user') {
    try {
      const call = await Call.findById(callId)
        .populate('caller')
        .populate({
          path: 'expert',
          populate: { path: 'user' }
        });

      if (!call) {
        throw new Error('Call not found');
      }

      // If call never connected, just mark as ended
      if (call.status !== CALL_STATES.CONNECTED) {
        call.status = CALL_STATES.ENDED;
        call.endTime = new Date();
        await call.save();
        await this.releaseExpert(call.expert._id);
        return { success: true, tokensSpent: 0 };
      }

      // Calculate duration
      call.endTime = new Date();
      const durationSeconds = Math.floor((call.endTime - call.startTime) / 1000);
      call.duration = durationSeconds;

      // Calculate tokens spent (minimum 1 minute, round up)
      const minutes = Math.max(1, Math.ceil(durationSeconds / 60));
      const tokensSpent = minutes * call.tokensPerMinute;
      call.tokensSpent = tokensSpent;
      call.status = CALL_STATES.ENDED;

      await call.save();

      // Deduct tokens from caller with atomic operation
      const caller = await User.findById(call.caller._id);
      const callerTokensBefore = caller.tokens;

      // Deduct only what's available (never go negative)
      const actualDeduction = Math.min(tokensSpent, caller.tokens);
      
      // Atomic update to prevent race conditions
      const updatedCaller = await User.findByIdAndUpdate(
        caller._id,
        {
          $inc: { tokens: -actualDeduction }
        },
        { new: true, runValidators: true }
      );

      // Ensure balance doesn't go negative
      if (updatedCaller.tokens < 0) {
        await User.findByIdAndUpdate(caller._id, { $set: { tokens: 0 } });
        updatedCaller.tokens = 0;
      }

      // Create caller transaction
      const callerTransaction = new Transaction({
        user: caller._id,
        type: 'debit',
        tokens: actualDeduction,
        description: `Call with ${call.expert.user.name} (${minutes} min)`,
        call: call._id,
        tokensBefore: callerTokensBefore,
        tokensAfter: updatedCaller.tokens
      });
      await callerTransaction.save();

      // Credit expert (90% of tokens) with atomic operation
      const expertTokens = Math.floor(actualDeduction * 0.9);
      
      const updatedExpert = await Expert.findByIdAndUpdate(
        call.expert._id,
        {
          $inc: {
            totalCalls: 1,
            totalMinutes: minutes,
            tokensEarned: expertTokens,
            unclaimedTokens: expertTokens
          },
          $set: {
            isBusy: false,
            currentCallId: null
          }
        },
        { new: true, runValidators: true }
      );

      return {
        success: true,
        callId,
        duration: durationSeconds,
        minutes,
        tokensSpent: actualDeduction,
        expertTokens,
        callerBalance: updatedCaller.tokens,
        initiatedBy
      };
    } catch (error) {
      console.error('CallStateManager.endCall error:', error);
      throw error;
    }
  }

  /**
   * Handle disconnect during call
   */
  static async handleDisconnect(callId, userId, userType) {
    try {
      const call = await Call.findById(callId);
      if (!call) {
        return { success: true }; // Already cleaned up
      }

      // If call was connected, treat as normal end
      if (call.status === CALL_STATES.CONNECTED) {
        return await this.endCall(callId, userType);
      }

      // If call was not connected, mark as failed
      call.status = CALL_STATES.FAILED;
      call.endTime = new Date();
      await call.save();

      // Release expert
      await this.releaseExpert(call.expert);

      return { success: true, reason: 'disconnect' };
    } catch (error) {
      console.error('CallStateManager.handleDisconnect error:', error);
      throw error;
    }
  }

  /**
   * Handle call timeout (no answer)
   */
  static async handleTimeout(callId) {
    try {
      const call = await Call.findById(callId);
      if (!call) {
        return { success: true };
      }

      // Only timeout if still ringing
      if (call.status === CALL_STATES.RINGING || call.status === CALL_STATES.INITIATED) {
        call.status = CALL_STATES.MISSED;
        call.endTime = new Date();
        await call.save();

        // Release expert
        await this.releaseExpert(call.expert);
      }

      return { success: true };
    } catch (error) {
      console.error('CallStateManager.handleTimeout error:', error);
      throw error;
    }
  }

  /**
   * Transition call state with validation
   */
  static async transitionState(callId, newState) {
    try {
      const call = await Call.findById(callId);
      if (!call) {
        throw new Error('Call not found');
      }

      const currentState = call.status;
      const validTransitions = VALID_TRANSITIONS[currentState] || [];

      if (!validTransitions.includes(newState)) {
        throw new Error(`Invalid state transition from ${currentState} to ${newState}`);
      }

      call.status = newState;
      await call.save();

      return { success: true, oldState: currentState, newState };
    } catch (error) {
      console.error('CallStateManager.transitionState error:', error);
      throw error;
    }
  }

  /**
   * Release expert from call (using status manager)
   */
  static async releaseExpert(expertId) {
    try {
      await releaseExpertStatus(expertId);
    } catch (error) {
      console.error('CallStateManager.releaseExpert error:', error);
    }
  }

  /**
   * Get call state
   */
  static async getCallState(callId) {
    try {
      const call = await Call.findById(callId)
        .populate('caller', 'name tokens')
        .populate({
          path: 'expert',
          populate: { path: 'user', select: 'name' }
        });

      if (!call) {
        return null;
      }

      return {
        callId: call._id,
        status: call.status,
        caller: call.caller,
        expert: call.expert,
        startTime: call.startTime,
        endTime: call.endTime,
        duration: call.duration,
        tokensSpent: call.tokensSpent,
        tokensPerMinute: call.tokensPerMinute
      };
    } catch (error) {
      console.error('CallStateManager.getCallState error:', error);
      return null;
    }
  }
}

module.exports = { CallStateManager, CALL_STATES };
