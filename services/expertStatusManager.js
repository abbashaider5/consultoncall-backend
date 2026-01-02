/**
 * Expert Status Manager
 * Ensures database is single source of truth for expert availability
 * Syncs socket state with database state
 */

const Expert = require('../models/Expert');
const logger = require('./logger');

// Status constants
const STATUS = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  BUSY: 'busy',
  IN_CALL: 'in_call'
};

/**
 * Get expert current status from database
 * @param {String} expertId - Expert document ID
 * @returns {Promise<Object>} Expert status info
 */
async function getExpertStatus(expertId) {
  try {
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

    return {
      expertId,
      status,
      isOnline: expert.isOnline,
      isBusy: expert.isBusy,
      currentCallId: expert.currentCallId,
      lastSeen: expert.lastSeen || new Date()
    };
  } catch (error) {
    logger.error('Error getting expert status:', error);
    throw error;
  }
}

/**
 * Set expert online status
 * @param {String} expertId - Expert document ID
 * @param {Boolean} isOnline - Online status
 * @returns {Promise<Object>} Updated expert
 */
async function setExpertOnline(expertId, isOnline = true) {
  try {
    const update = {
      isOnline,
      lastSeen: new Date()
    };

    const expert = await Expert.findByIdAndUpdate(
      expertId,
      update,
      { new: true, runValidators: true }
    );

    if (!expert) {
      throw new Error('Expert not found');
    }

    logger.info(`Expert ${expertId} set ${isOnline ? 'online' : 'offline'}`);
    
    return expert;
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
 * @returns {Promise<Object>} Updated expert
 */
async function setExpertBusy(expertId, isBusy = true, callId = null) {
  try {
    const update = {
      isBusy
    };

    if (isBusy && callId) {
      update.currentCallId = callId;
    } else {
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

    logger.info(`Expert ${expertId} set ${isBusy ? 'busy' : 'available'}${callId ? ` (call: ${callId})` : ''}`);
    
    return expert;
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
 * Check if expert is available for new calls
 * @param {String} expertId - Expert document ID
 * @returns {Promise<Boolean>} True if available
 */
async function isExpertAvailable(expertId) {
  try {
    const expert = await Expert.findById(expertId);
    
    if (!expert) {
      return false;
    }

    // Expert is available if online and not busy
    return expert.isOnline && !expert.isBusy;
  } catch (error) {
    logger.error('Error checking expert availability:', error);
    return false;
  }
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
  setExpertOnline,
  setExpertBusy,
  releaseExpert,
  isExpertAvailable,
  getOnlineExperts,
  getAvailableExperts,
  syncExpertStatus,
  bulkSyncExpertStatuses,
  cleanupInactiveExperts,
  resetAllExpertBusyStates
};
