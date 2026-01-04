const RtcTokenBuilder = require('agora-token').RtcTokenBuilder;
const RtcRole = require('agora-token').RtcRole;

// Get Agora credentials from environment variables
const AGORA_APP_ID = process.env.AGORA_APP_ID;
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;
const AGORA_CHAT_APP_KEY = process.env.AGORA_CHAT_APP_KEY;

/**
 * Generate Agora RTC token for audio calling
 * @param {string} channelName - The channel name for the call
 * @param {string} uid - User ID (string representation)
 * @param {number} role - 1 for publisher, 2 for subscriber
 * @param {number} expiration - Token expiration time in seconds (default: 3600 = 1 hour)
 * @returns {string} Agora RTC token
 */
const generateRtcToken = (channelName, uid, role = RtcRole.PUBLISHER, expiration = 3600) => {
  if (!AGORA_APP_ID || !AGORA_APP_CERTIFICATE) {
    throw new Error('Agora credentials not configured');
  }

  // Current timestamp + expiration
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const privilegeExpiredTs = currentTimestamp + expiration;

  // Generate token
  const token = RtcTokenBuilder.buildTokenWithUid(
    AGORA_APP_ID,
    AGORA_APP_CERTIFICATE,
    channelName,
    uid,
    role,
    privilegeExpiredTs
  );

  return token;
};

/**
 * Generate Agora Chat user token
 * Note: This is a simplified implementation. In production, you would use Agora Chat REST API
 * For now, we'll generate a mock token that should be replaced with actual Agora Chat token generation
 * @param {string} username - Chat username
 * @param {number} expiration - Token expiration time in seconds (default: 86400 = 24 hours)
 * @returns {string} Agora Chat token
 */
const generateChatToken = (username, expiration = 86400) => {
  if (!AGORA_CHAT_APP_KEY) {
    throw new Error('Agora Chat credentials not configured');
  }

  // Generate a simple token format
  // In production, use Agora Chat REST API to generate proper tokens
  const timestamp = Date.now();
  const tokenData = `${AGORA_CHAT_APP_KEY}:${username}:${timestamp}:${expiration}`;
  
  // Simple encoding - in production use proper JWT or Agora's token generation
  return Buffer.from(tokenData).toString('base64');
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
  RtcRole,
  AGORA_APP_ID,
  AGORA_CHAT_APP_KEY
};
