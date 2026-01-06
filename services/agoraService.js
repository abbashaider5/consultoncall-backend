const crypto = require('crypto');

// Get Agora credentials from environment variables
const AGORA_APP_ID = process.env.AGORA_APP_ID;
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;
const AGORA_CHAT_APP_KEY = process.env.AGORA_CHAT_APP_KEY;
const AGORA_CHAT_CLIENT_ID = process.env.AGORA_CHAT_CLIENT_ID;
const AGORA_CHAT_CLIENT_SECRET = process.env.AGORA_CHAT_CLIENT_SECRET;

/**
 * Generate Agora Chat user token
 * Uses agora-access-token package for proper Agora Chat token generation
 * CRITICAL: Uses ONLY user._id as string - no prefixes, no modifications
 * @param {string} userId - User ID from database (must be plain string)
 * @param {number} expiration - Token expiration time in seconds (default: 86400 = 24 hours)
 * @returns {object} { token, userId } - Agora Chat token and userId used
 */
const generateChatToken = (userId, expiration = 86400) => {
  if (!AGORA_CHAT_APP_KEY) {
    throw new Error('Agora Chat credentials not configured');
  }

  // CRITICAL: Use EXACT userId as provided - no modifications
  // This userId MUST match what frontend uses in client.open()
  const chatUserId = String(userId);
  
  console.log('🔑 Generating Agora Chat token for userId:', chatUserId);
  
  // Use agora-access-token package for proper Agora Chat token generation
  try {
    const { RtmTokenBuilder } = require('agora-access-token');
    
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expiration;

    // Build Agora Chat token using RtmTokenBuilder
    // Agora Chat SDK uses the same token format as RTM
    const token = RtmTokenBuilder.buildToken(
      AGORA_CHAT_APP_KEY,  // appId for RTM/Chat
      AGORA_CHAT_APP_KEY,   // appCert for RTM/Chat
      chatUserId,            // userId - EXACT string, no modifications
      RtmTokenBuilder.Role.RtmUser,
      privilegeExpiredTs
    );

    console.log('✅ Agora Chat token generated successfully for userId:', chatUserId);
    
    return {
      token: token,
      userId: chatUserId // Return userId used for generation
    };
  } catch (error) {
    console.error('❌ Agora Chat token generation error:', error);
    
    // Fallback: Try using appKey directly without token (for development only)
    if (process.env.NODE_ENV === 'development') {
      console.warn('⚠️ Using appKey directly (development mode only)');
      return {
        token: null, // No token, will use appKey
        userId: chatUserId
      };
    }
    
    throw new Error('Failed to generate chat token: ' + error.message);
  }
};

/**
 * Generate Agora RTC token for audio calling
 * @param {string} channelName - The channel name for call
 * @param {string} uid - User ID (string representation)
 * @param {number} role - 1 for publisher, 2 for subscriber
 * @param {number} expiration - Token expiration time in seconds (default: 3600 = 1 hour)
 * @returns {string} Agora RTC token
 */
const generateRtcToken = (channelName, uid, role = 1, expiration = 3600) => {
  if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
    throw new Error('Agora RTC credentials not configured');
  }

  // Try to use agora-token package
  try {
    const RtcTokenBuilder = require('agora-token').RtcTokenBuilder;
    
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const privilegeExpiredTs = currentTimestamp + expiration;

    const token = RtcTokenBuilder.buildTokenWithUid(
      AGORA_APP_ID,
      AGORA_APP_CERTIFICATE,
      channelName,
      uid,
      role,
      privilegeExpiredTs
    );

    return token;
  } catch (error) {
    console.error('Agora RTC token generation error:', error);
    throw new Error('Failed to generate RTC token');
  }
};

/**
 * Generate channel name for a call
 * Format: call_{callId}
 * @param {string} callId - The database call ID
 * @returns {string} Agora channel name
 */
const generateChannelName = (callId) => {
  return `call_${callId}`;
};

/**
 * Generate UID for Agora
 * Format: {userType}_{userId}
 * @param {string} userId - Database user ID
 * @param {string} userType - 'user' or 'expert'
 * @returns {string} Agora UID
 */
const generateUid = (userId, userType) => {
  return `${userType}_${userId}`;
};

/**
 * Parse UID to extract user info
 * @param {string} agoraUid - Agora UID
 * @returns {object} { userType, userId }
 */
const parseUid = (agoraUid) => {
  const parts = agoraUid.split('_');
  return {
    userType: parts[0],
    userId: parts.slice(1).join('_')
  };
};

module.exports = {
  generateRtcToken,
  generateChatToken,
  generateChannelName,
  generateUid,
  parseUid,
  AGORA_APP_ID,
  AGORA_CHAT_APP_KEY
};
