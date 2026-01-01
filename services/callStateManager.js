/**
 * Call State Manager - Single Source of Truth for Call State
 * Implements strict state machine for call lifecycle
 */

const Call = require('../models/Call');
const User = require('../models/User');
const Expert = require('../models/Expert');
const Transaction = require('../models/Transaction');

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
      
      // Set expert busy when call starts ringing
      const call = await Call.findById(callId).populate('expert');
      if (call && call.expert) {
        call.expert.isBusy = true;
        call.expert.currentCallId = callId;
        await call.expert.save();
      }
      
      return result;
    } catch (error) {
      // On failure, ensure expert is released
      try {
        const call = await Call.findById(callId);
        if (call) {
          await this.releaseExpert(call.expert);
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
   * End call - calculate billing, update balances
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

      // Deduct tokens from caller
      const caller = await User.findById(call.caller._id);
      const callerTokensBefore = caller.tokens;

      // Deduct only what's available
      const actualDeduction = Math.min(tokensSpent, caller.tokens);
      caller.tokens -= actualDeduction;
      if (caller.tokens < 0) caller.tokens = 0;
      await caller.save();

      // Create caller transaction
      const callerTransaction = new Transaction({
        user: caller._id,
        type: 'debit',
        tokens: actualDeduction,
        description: `Call with ${call.expert.user.name} (${minutes} min)`,
        call: call._id,
        tokensBefore: callerTokensBefore,
        tokensAfter: caller.tokens
      });
      await callerTransaction.save();

      // Credit expert (90% of tokens)
      const expertTokens = Math.floor(actualDeduction * 0.9);
      const expert = await Expert.findById(call.expert._id);
      
      expert.totalCalls += 1;
      expert.totalMinutes += minutes;
      expert.tokensEarned += expertTokens;
      expert.unclaimedTokens += expertTokens;
      expert.isBusy = false;
      expert.currentCallId = null;
      await expert.save();

      return {
        success: true,
        callId,
        duration: durationSeconds,
        minutes,
        tokensSpent: actualDeduction,
        expertTokens,
        callerBalance: caller.tokens
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
   * Release expert from call
   */
  static async releaseExpert(expertId) {
    try {
      const expert = await Expert.findById(expertId);
      if (expert) {
        expert.isBusy = false;
        expert.currentCallId = null;
        await expert.save();
      }
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
