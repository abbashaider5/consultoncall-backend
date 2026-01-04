const express = require('express');
const { auth } = require('../middleware/auth');
const {
  generateRtcToken,
  generateChatToken,
  generateChannelName,
  generateUid,
  AGORA_APP_ID,
  AGORA_CHAT_APP_KEY
} = require('../services/agoraService');

const router = express.Router();

/**
 * Generate Agora RTC token for audio call
 * POST /api/agora/rtc-token
 * Body: { callId, userType }
 */
router.post('/rtc-token', auth, async (req, res) => {
  try {
    const { callId, userType = 'user' } = req.body;

    if (!callId) {
      return res.status(400).json({
        success: false,
        message: 'Call ID is required'
      });
    }

    // Validate user type
    if (!['user', 'expert'].includes(userType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid user type. Must be "user" or "expert"'
      });
    }

    // Generate channel name and UID
    const channelName = generateChannelName(callId);
    const uid = generateUid(req.user._id.toString(), userType);

    // Generate RTC token (valid for 1 hour)
    const token = generateRtcToken(channelName, uid, 1, 3600);

    res.json({
      success: true,
      appId: AGORA_APP_ID,
      channel: channelName,
      uid: uid,
      token: token,
      role: 'publisher'
    });
  } catch (error) {
    console.error('Generate RTC token error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate RTC token'
    });
  }
});

/**
 * Generate Agora Chat token
 * POST /api/agora/chat-token
 * Body: { username }
 */
router.post('/chat-token', auth, async (req, res) => {
  try {
    const { username } = req.body;

    // Use user ID as username if not provided
    const chatUsername = username || req.user._id.toString();

    // Generate chat token (valid for 24 hours)
    const token = generateChatToken(chatUsername, 86400);

    res.json({
      success: true,
      appKey: AGORA_CHAT_APP_KEY,
      username: chatUsername,
      token: token
    });
  } catch (error) {
    console.error('Generate chat token error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate chat token'
    });
  }
});

/**
 * Get Agora configuration (for frontend initialization)
 * GET /api/agora/config
 */
router.get('/config', (req, res) => {
  res.json({
    success: true,
    rtc: {
      appId: AGORA_APP_ID
    },
    chat: {
      appKey: AGORA_CHAT_APP_KEY
    }
  });
});

module.exports = router;
