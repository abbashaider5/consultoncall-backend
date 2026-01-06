const crypto = require('crypto');

// Get Agora credentials from environment variables
const AGORA_APP_ID = process.env.AGORA_APP_ID;
const AGORA_APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE;
const AGORA_CHAT_APP_KEY = process.env.AGORA_CHAT_APP_KEY;
const AGORA_CHAT_CLIENT_ID = process.env.AGORA_CHAT_CLIENT_ID;
const AGORA_CHAT_CLIENT_SECRET = process.env.AGORA_CHAT_CLIENT_SECRET;

/**
 * Generate Agora Chat user token
 * Uses HMAC-SHA256 signature for Agora Chat REST API authentication
 * @param {string} username - Chat username (user ID)
 * @param {number} expiration - Token expiration time in seconds (default: 86400 = 24 hours)
 * @returns {string} Agora Chat token
 */
const generateChatToken = (username, expiration = 86400) => {
  if (!AGORA_CHAT_APP_KEY) {
    throw new Error('Agora Chat credentials not configured');
  }

  // For Agora Chat SDK v1.x, we use a simple token format
  // The SDK will handle authentication with appKey
  // In production, implement proper token generation using Agora Chat REST API
  
  const timestamp = Date.now();
  const expireTimestamp = timestamp + (expiration * 1000);
  
  // Create token payload
  const payload = {
    appKey: AGORA_CHAT_APP_KEY,
    username: username,
    timestamp: timestamp,
    expire: expireTimestamp
  };
  
  // Create signature
  const signature = crypto
    .createHmac('sha256', AGORA_CHAT_APP_KEY)
    .update(JSON.stringify(payload))
    .digest('hex');
  
  // Return token as JSON string (Agora Chat SDK format)
  const token = JSON.stringify({
    ...payload,
    signature: signature
  });
  
  // Base64 encode for safe transport
  return Buffer.from(token).toString('base64');
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
