/**
 * Expert Status Manager
 * Ensures database is single source of truth for expert availability
 * Provides comprehensive real-time status management with edge case handling
 */

const Expert = require('../models/Expert');
const logger = require('./logger');
const Call = require('../models/Call');

// Status constants
const STATUS = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  BUSY: 'busy',
  IN_CALL: 'in_call',
  AWAY: 'away'
};

// Status transition validation matrix
const VALID_TRANSITIONS = {
  [STATUS.OFFLINE]: [STATUS.ONLINE],
  [STATUS.ONLINE]: [STATUS.OFFLINE, STATUS.BUSY, STATUS.AWAY],
  [STATUS.BUSY]: [STATUS.ONLINE, STATUS.OFFLINE],
  [STATUS.AWAY]: [STATUS.ONLINE, STATUS.OFFLINE]
};

// Cache for performance (5 minute TTL)
const statusCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get expert current status from database with caching
 * @param {String} expertId - Expert document ID
 * @param {Boolean} bypassCache - Skip cache and fetch from DB
 * @returns {Promise<Object>} Expert status info
 */
async function getExpertStatus(expertId, bypassCache = false) {
  try {
    // Check cache first
    if (!bypassCache && statusCache.has(expertId)) {
      const cached = statusCache.get(expertId);
      if (Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
      }
    }

    const expert = await Expert.findById(expertId);
    
    if (!expert) {
      throw new Error('Expert not found');
    }

    // Determine status based on fields
    let status = STATUS.OFFLINE;
    
    if (expert.isOnline) {
      if (expert.isBusy || expert.currentCallId) {
        status = STATUS.BUSY;
      } else {
        status = STATUS.ONLINE;
      }
    }

    const statusData = {
      expertId,
      status,
      isOnline: expert.isOnline,
      isBusy: expert.isBusy,
      currentCallId: expert.currentCallId,
      lastSeen: expert.lastSeen || expert.updatedAt || new Date(),
      isAvailable: expert.isAvailable !== false
    };

    // Update cache
    statusCache.set(expertId, {
      data: statusData,
      timestamp: Date.now()
    });

    return statusData;
  } catch (error) {
    logger.error('Error getting expert status:', error);
    throw error;
  }
}

/**
 * Validate status transition
 * @param {String} fromStatus - Current status
 * @param {String} toStatus - New status
 * @returns {Boolean} True if transition is valid
 */
function isValidTransition(fromStatus, toStatus) {
  const allowedTransitions = VALID_TRANSITIONS[fromStatus] || [];
  return allowedTransitions.includes(toStatus);
}

/**
 * Update expert status with transition validation
 * @param {String} expertId - Expert document ID
 * @param {Object} statusUpdate - Status update object
 * @returns {Promise<Object>} Updated expert status
 */
async function updateExpertStatus(expertId, statusUpdate) {
  try {
    const expert = await Expert.findById(expertId);
    
    if (!expert) {
      throw new Error('Expert not found');
    }

    const currentStatus = expert.isOnline 
      ? (expert.isBusy ? STATUS.BUSY : STATUS.ONLINE)
      : STATUS.OFFLINE;

    // Determine new status
    let newStatus = currentStatus;
    if (statusUpdate.isOnline !== undefined) {
      newStatus = statusUpdate.isOnline 
        ? (statusUpdate.isBusy ? STATUS.BUSY : STATUS.ONLINE)
        : STATUS.OFFLINE;
    } else if (statusUpdate.isBusy !== undefined) {
      newStatus = statusUpdate.isBusy ? STATUS.BUSY : STATUS.ONLINE;
    }

    // Validate transition (skip for internal system updates)
    if (statusUpdate.validateTransition !== false && !isValidTransition(currentStatus, newStatus)) {
      logger.warn(`Invalid status transition for expert ${expertId}: ${currentStatus} -> ${newStatus}`);
      // Allow the transition anyway for robustness, but log it
    }

    // Apply updates
    if (statusUpdate.isOnline !== undefined) {
      expert.isOnline = statusUpdate.isOnline;
    }
    if (statusUpdate.isBusy !== undefined) {
      expert.isBusy = statusUpdate.isBusy;
    }
    if (statusUpdate.currentCallId !== undefined) {
      expert.currentCallId = statusUpdate.currentCallId;
    }
    if (statusUpdate.isAvailable !== undefined) {
      expert.isAvailable = statusUpdate.isAvailable;
    }

    expert.lastSeen = new Date();
    await expert.save();

    // Clear cache to force fresh read next time
    statusCache.delete(expertId);

    logger.info(`Expert ${expertId} status updated: ${currentStatus} -> ${newStatus}`);
    
    return getExpertStatus(expertId, true); // Force fresh read
  } catch (error) {
    logger.error('Error updating expert status:', error);
    throw error;
  }
}

/**
 * Set expert online status (with auto-busy clearing)
 * @param {String} expertId - Expert document ID
 * @param {Boolean} isOnline - Online status
 * @param {String} reason - Reason for status change
 * @returns {Promise<Object>} Updated expert status
 */
async function setExpertOnline(expertId, isOnline = true, reason = 'manual') {
  try {
    const update = {
      isOnline,
      lastSeen: new Date()
    };

    // Clear busy status when going offline or when explicitly requested
    if (!isOnline) {
      update.isBusy = false;
      update.currentCallId = null;
    }

    const expert = await Expert.findByIdAndUpdate(
      expertId,
      update,
      { new: true, runValidators: true }
    );

    if (!expert) {
      throw new Error('Expert not found');
    }

    // Clear cache
    statusCache.delete(expertId);

    logger.info(`Expert ${expertId} set ${isOnline ? 'online' : 'offline'} (reason: ${reason})`);
    
    return getExpertStatus(expertId, true);
  } catch (error) {
    logger.error('Error setting expert online status:', error);
    throw error;
  }
}

/**
 * Set expert busy status (when in call)
 * @param {String} expertId - Expert document ID
 * @param {Boolean} isBusy - Busy status
 * @param {String} callId - Current call ID (if busy)
 * @param {String} reason - Reason for status change
 * @returns {Promise<Object>} Updated expert status
 */
async function setExpertBusy(expertId, isBusy = true, callId = null, reason = 'call') {
  try {
    const update = {
      isBusy
    };

    if (isBusy && callId) {
      update.currentCallId = callId;
    } else {
      update.currentCallId = null;
    }

    // Ensure expert is online when setting busy
    if (isBusy) {
      update.isOnline = true;
    }

    update.lastSeen = new Date();

    const expert = await Expert.findByIdAndUpdate(
      expertId,
      update,
      { new: true, runValidators: true }
    );

    if (!expert) {
      throw new Error('Expert not found');
    }

    // Clear cache
    statusCache.delete(expertId);

    logger.info(`Expert ${expertId} set ${isBusy ? 'busy' : 'available'} (reason: ${reason}${callId ? `, call: ${callId})` : ')'}`);
    
    return getExpertStatus(expertId, true);
  } catch (error) {
    logger.error('Error setting expert busy status:', error);
    throw error;
  }
}

/**
 * Release expert from busy state (call ended)
 * @param {String} expertId - Expert document ID
 * @returns {Promise<Object>} Updated expert
 */
async function releaseExpert(expertId) {
  return setExpertBusy(expertId, false, null);
}

/**
 * Check if expert is available for new calls (with cache)
 * @param {String} expertId - Expert document ID
 * @returns {Promise<Boolean>} True if available
 */
async function isExpertAvailable(expertId) {
  try {
    const status = await getExpertStatus(expertId);
    return status.isOnline && !status.isBusy && status.isAvailable;
  } catch (error) {
    logger.error('Error checking expert availability:', error);
    return false;
  }
}

/**
 * Get expert status for UI display
 * @param {String} expertId - Expert document ID
 * @returns {Promise<Object>} Status info for UI
 */
async function getExpertStatusForUI(expertId) {
  try {
    const status = await getExpertStatus(expertId);
    
    return {
      expertId,
      status: status.status,
      text: status.isBusy ? 'Busy' : (status.isOnline ? 'Online' : 'Offline'),
      color: status.isBusy ? '#fd7e14' : (status.isOnline ? '#28a745' : '#6c757d'),
      canCall: status.isOnline && !status.isBusy && status.isAvailable,
      canChat: status.isAvailable,
      lastSeen: status.lastSeen,
      currentCallId: status.currentCallId
    };
  } catch (error) {
    logger.error('Error getting expert status for UI:', error);
    return {
      expertId,
      status: STATUS.OFFLINE,
      text: 'Offline',
      color: '#6c757d',
      canCall: false,
      canChat: false
    };
  }
}

/**
 * Handle expert disconnect event
 * @param {String} expertId - Expert document ID
 * @param {Boolean} inActiveCall - Whether expert was in an active call
 * @returns {Promise<Object>} Updated expert status
 */
async function handleExpertDisconnect(expertId, inActiveCall = false) {
  try {
    const expert = await Expert.findById(expertId);
    
    if (!expert) {
      throw new Error('Expert not found');
    }

    // If expert was in a call, keep them as busy (socket reconnect may restore)
    // If not in call, clear busy status
    if (!inActiveCall && expert.isBusy) {
      logger.info(`Expert ${expertId} disconnected - clearing busy status`);
      await setExpertBusy(expertId, false, null, 'disconnect');
    }

    // Update last seen
    expert.lastSeen = new Date();
    await expert.save();

    // Clear cache
    statusCache.delete(expertId);

    logger.info(`Expert ${expertId} disconnected (was in call: ${inActiveCall})`);
    
    return getExpertStatus(expertId, true);
  } catch (error) {
    logger.error('Error handling expert disconnect:', error);
    throw error;
  }
}

/**
 * Handle expert reconnect event
 * @param {String} expertId - Expert document ID
 * @returns {Promise<Object>} Updated expert status
 */
async function handleExpertReconnect(expertId) {
  try {
    const expert = await Expert.findById(expertId);
    
    if (!expert) {
      throw new Error('Expert not found');
    }

    // Check if expert has any active calls
    const activeCalls = await Call.find({
      expert: expertId,
      status: { $in: ['ringing', 'connected', 'accepted'] }
    });

    // If expert has active calls, ensure they're marked as busy
    if (activeCalls.length > 0 && !expert.isBusy) {
      logger.info(`Expert ${expertId} reconnected - has ${activeCalls.length} active call(s), setting busy`);
      await setExpertBusy(expertId, true, activeCalls[0]._id, 'reconnect_active_call');
    }

    // Update last seen
    expert.lastSeen = new Date();
    await expert.save();

    // Clear cache
    statusCache.delete(expertId);

    logger.info(`Expert ${expertId} reconnected`);
    
    return getExpertStatus(expertId, true);
  } catch (error) {
    logger.error('Error handling expert reconnect:', error);
    throw error;
  }
}

/**
 * Sync expert status from active calls
 * Runs periodically to ensure DB matches actual call state
 * @returns {Promise<Array>} Array of synced experts
 */
async function syncStatusFromActiveCalls() {
  try {
    const activeCalls = await Call.find({
      status: { $in: ['ringing', 'connected', 'accepted'] }
    });

    const expertUpdates = [];

    for (const call of activeCalls) {
      try {
        const expert = await Expert.findById(call.expert);
        
        if (expert) {
          // Expert should be busy if they have an active call
          if (!expert.isBusy) {
            logger.info(`Auto-setting busy for expert ${expert._id} (has active call: ${call._id})`);
            await setExpertBusy(expert._id, true, call._id, 'auto_sync');
            expertUpdates.push({
              expertId: expert._id,
              reason: 'auto_sync',
              callId: call._id
            });
          }
        }
      } catch (error) {
        logger.error(`Error syncing expert ${call.expert} status:`, error.message);
      }
    }

    return expertUpdates;
  } catch (error) {
    logger.error('Error syncing status from active calls:', error);
    return [];
  }
}

/**
 * Clear status cache for specific expert
 * @param {String} expertId - Expert document ID
 */
function clearExpertCache(expertId) {
  statusCache.delete(expertId);
}

/**
 * Clear entire status cache
 */
function clearAllCache() {
  statusCache.clear();
  logger.info('Expert status cache cleared');
}

/**
 * Get all online experts
 * @returns {Promise<Array>} Array of online experts
 */
async function getOnlineExperts() {
  try {
    const experts = await Expert.find({ isOnline: true })
      .populate('user', 'name avatar')
      .populate('categories', 'name')
      .lean();

    return experts.map(expert => ({
      ...expert,
      status: expert.isBusy ? STATUS.BUSY : STATUS.ONLINE
    }));
  } catch (error) {
    logger.error('Error getting online experts:', error);
    return [];
  }
}

/**
 * Get all available experts (online and not busy)
 * @returns {Promise<Array>} Array of available experts
 */
async function getAvailableExperts() {
  try {
    const experts = await Expert.find({
      isOnline: true,
      isBusy: false
    })
      .populate('user', 'name avatar')
      .populate('categories', 'name')
      .lean();

    return experts;
  } catch (error) {
    logger.error('Error getting available experts:', error);
    return [];
  }
}

/**
 * Sync expert status from database (for socket server)
 * Called when socket server connects to ensure consistency
 * @param {String} expertId - Expert document ID
 * @returns {Promise<Object>} Expert status from database
 */
async function syncExpertStatus(expertId) {
  try {
    const status = await getExpertStatus(expertId);
    logger.info(`Synced expert ${expertId} status: ${status.status}`);
    return status;
  } catch (error) {
    logger.error('Error syncing expert status:', error);
    throw error;
  }
}

/**
 * Bulk sync multiple expert statuses
 * @param {Array<String>} expertIds - Array of expert document IDs
 * @returns {Promise<Array>} Array of expert statuses
 */
async function bulkSyncExpertStatuses(expertIds) {
  try {
    const experts = await Expert.find({
      _id: { $in: expertIds }
    }).lean();

    return experts.map(expert => ({
      expertId: expert._id.toString(),
      status: expert.isOnline ? (expert.isBusy ? STATUS.BUSY : STATUS.ONLINE) : STATUS.OFFLINE,
      isOnline: expert.isOnline,
      isBusy: expert.isBusy,
      currentCallId: expert.currentCallId,
      lastSeen: expert.lastSeen || new Date()
    }));
  } catch (error) {
    logger.error('Error bulk syncing expert statuses:', error);
    return [];
  }
}

/**
 * Auto-set experts offline if not seen recently
 * Should be called periodically (e.g., every 5 minutes)
 * @param {Number} minutesInactive - Minutes of inactivity before setting offline (default: 5)
 * @returns {Promise<Number>} Number of experts set offline
 */
async function cleanupInactiveExperts(minutesInactive = 5) {
  try {
    const inactiveThreshold = new Date(Date.now() - minutesInactive * 60 * 1000);
    
    const result = await Expert.updateMany(
      {
        isOnline: true,
        lastSeen: { $lt: inactiveThreshold }
      },
      {
        isOnline: false,
        isBusy: false,
        currentCallId: null
      }
    );

    if (result.modifiedCount > 0) {
      logger.info(`Set ${result.modifiedCount} inactive experts offline`);
    }

    return result.modifiedCount;
  } catch (error) {
    logger.error('Error cleaning up inactive experts:', error);
    return 0;
  }
}

/**
 * Reset all expert busy states (emergency function)
 * Use only if system gets into inconsistent state
 * @returns {Promise<Number>} Number of experts reset
 */
async function resetAllExpertBusyStates() {
  try {
    const result = await Expert.updateMany(
      {
        isBusy: true
      },
      {
        isBusy: false,
        currentCallId: null
      }
    );

    logger.warn(`Reset ${result.modifiedCount} experts from busy state`);
    return result.modifiedCount;
  } catch (error) {
    logger.error('Error resetting expert busy states:', error);
    return 0;
  }
}

module.exports = {
  STATUS,
  getExpertStatus,
  updateExpertStatus,
  setExpertOnline,
  setExpertBusy,
  releaseExpert,
  isExpertAvailable,
  getExpertStatusForUI,
  handleExpertDisconnect,
  handleExpertReconnect,
  syncStatusFromActiveCalls,
  getOnlineExperts,
  getAvailableExperts,
  syncExpertStatus,
  bulkSyncExpertStatuses,
  cleanupInactiveExperts,
  resetAllExpertBusyStates,
  clearExpertCache,
  clearAllCache
};
