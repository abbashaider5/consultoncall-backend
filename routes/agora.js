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

// Root route to verify agora router is loaded
router.get('/', (req, res) => {
  console.log('📋 /api/agora endpoint hit');
  res.json({
    success: true,
    message: 'Agora API is running',
    endpoints: [
      'GET /api/agora/test',
      'GET /api/agora/chat-token',
      'POST /api/agora/rtc-token',
      'GET /api/agora/config'
    ],
    timestamp: new Date().toISOString()
  });
});

// Test route to verify agora routes are loaded
router.get('/test', (req, res) => {
  console.log('📋 /api/agora/test endpoint hit');
  res.json({
    success: true,
    message: 'Agora routes are working',
    timestamp: new Date().toISOString()
  });
});

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
 * GET /api/agora/chat-token
 */
router.get('/chat-token', auth, async (req, res) => {
  try {
    const userId = req.user._id.toString();

    // Generate chat token (valid for 24 hours)
    const tokenResult = generateChatToken(userId, 86400);

    return res.json({
      success: true,
      rtmUserId: tokenResult.rtmUserId,
      token: tokenResult.token
    });
  } catch (error) {
    console.error('❌ Generate chat token error:', error);
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
