const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const streamifier = require('streamifier');
const path = require('path');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Expert = require('../models/Expert');
const Call = require('../models/Call');
const { auth, adminAuth } = require('../middleware/auth');

const router = express.Router();

// Configure Cloudinary
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('Cloudinary environment variables not set properly');
  console.error('CLOUD_NAME:', process.env.CLOUDINARY_CLOUD_NAME ? 'Set' : 'Not set');
  console.error('API_KEY:', process.env.CLOUDINARY_API_KEY ? 'Set' : 'Not set');
  console.error('API_SECRET:', process.env.CLOUDINARY_API_SECRET ? 'Set (length: ' + process.env.CLOUDINARY_API_SECRET?.length + ')' : 'Not set');
}

// Configure Cloudinary if all credentials are available
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
  console.log('Cloudinary configured successfully');
} else {
  console.warn('Cloudinary not configured - avatar uploads will not work');
}

// Configure multer for avatar uploads (memory storage)
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error('Only image files are allowed'));
  }
});

// Initialize Razorpay with test keys
// NOTE: You must set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables
// Get test keys from https://dashboard.razorpay.com/app/keys
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_demo';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'demo_secret_key';

let razorpay = null;
const isRazorpayConfigured = RAZORPAY_KEY_ID !== 'rzp_test_demo' && RAZORPAY_KEY_ID.startsWith('rzp_');

if (isRazorpayConfigured) {
  razorpay = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
  });
}

// Upload avatar
router.post('/upload-avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Check if Cloudinary is configured
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(500).json({
        message: 'File upload service not configured. Please contact administrator.',
        success: false
      });
    }

    // Upload to Cloudinary manually
    const uploadPromise = new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'consultoncall/avatars',
          allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
          transformation: [
            { width: 300, height: 300, crop: 'fill', gravity: 'face' }
          ]
        },
        (error, result) => {
          if (error) {
            console.error('Cloudinary upload error:', error);
            reject(error);
          } else {
            resolve(result);
          }
        }
      );

      streamifier.createReadStream(req.file.buffer).pipe(stream);
    });

    const result = await uploadPromise;

    // Update user avatar
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { avatar: result.secure_url },
      { new: true }
    ).select('-password');

    res.json({
      message: 'Avatar uploaded successfully',
      avatar: result.secure_url,
      user
    });
  } catch (error) {
    console.error('Avatar upload error:', error);
    res.status(500).json({
      message: error.message || 'Failed to upload avatar',
      success: false
    });
  }
});

// Check username availability
router.get('/check-username/:username', auth, async (req, res) => {
  try {
    const { username } = req.params;
    
    // Validate username format
    if (!/^[a-z0-9_]+$/.test(username.toLowerCase())) {
      return res.status(400).json({ 
        available: false, 
        message: 'Username can only contain lowercase letters, numbers, and underscores' 
      });
    }
    
    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ 
        available: false, 
        message: 'Username must be between 3 and 30 characters' 
      });
    }
    
    // Check if username is already taken
    const existingUser = await User.findOne({ 
      username: username.toLowerCase(), 
      _id: { $ne: req.user._id } 
    });
    
    if (existingUser) {
      return res.json({ available: false, message: 'Username is already taken' });
    }
    
    res.json({ available: true, message: 'Username is available' });
  } catch (error) {
    console.error('Check username error:', error);
    res.status(500).json({ available: false, message: 'Server error' });
  }
});

// Update user profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { name, username, phone, avatar, country, bio } = req.body;
    
    // Validate username if provided
    if (username) {
      // Check if username is already taken
      const existingUser = await User.findOne({ 
        username: username.toLowerCase(), 
        _id: { $ne: req.user._id } 
      });
      
      if (existingUser) {
        return res.status(400).json({ message: 'Username is already taken' });
      }
      
      // Validate username format
      if (!/^[a-z0-9_]+$/.test(username.toLowerCase())) {
        return res.status(400).json({ message: 'Username can only contain lowercase letters, numbers, and underscores' });
      }
      
      if (username.length < 3 || username.length > 30) {
        return res.status(400).json({ message: 'Username must be between 3 and 30 characters' });
      }
    }
    
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { 
        name, 
        username: username ? username.toLowerCase() : undefined,
        phone, 
        avatar, 
        country, 
        bio 
      },
      { new: true }
    ).select('-password');
    
    res.json(user);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ message: error.message || 'Server error' });
  }
});

// Buy tokens for user account
router.post('/buy-tokens', auth, async (req, res) => {
  try {
    const { tokens } = req.body;
    
    if (!tokens || tokens < 100) {
      return res.status(400).json({ message: 'Minimum purchase is ₹100' });
    }

    const user = await User.findById(req.user._id);
    const tokensBefore = user.tokens;
    
    user.tokens += tokens;
    await user.save();

    // Create transaction record
    const transaction = new Transaction({
      user: user._id,
      type: 'credit',
      tokens,
      description: 'Tokens purchased',
      tokensBefore,
      tokensAfter: user.tokens
    });
    await transaction.save();

    res.json({
      message: 'Tokens purchased successfully',
      tokens: user.tokens,
      transaction
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Create Razorpay order
router.post('/create-order', auth, async (req, res) => {
  try {
    const { amount } = req.body;
    
    if (!amount || amount < 100) {
      return res.status(400).json({ message: 'Minimum amount is ₹100' });
    }

    // Check if Razorpay is configured
    if (!isRazorpayConfigured || !razorpay) {
      return res.status(503).json({ 
        message: 'Payment gateway not configured. Please use Demo Payment or contact support.',
        configured: false
      });
    }

    const options = {
      amount: amount * 100, // Razorpay expects amount in paise
      currency: 'INR',
      receipt: `order_${Date.now()}_${req.user._id}`,
      notes: {
        userId: req.user._id.toString(),
        tokens: amount.toString()
      }
    };

    const order = await razorpay.orders.create(options);
    
    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: RAZORPAY_KEY_ID
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ 
      message: error.message || 'Failed to create payment order. Please use Demo Payment.',
      configured: isRazorpayConfigured
    });
  }
});

// Verify Razorpay payment
router.post('/verify-payment', auth, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, amount } = req.body;
    
    // Verify signature
    const sign = razorpay_order_id + '|' + razorpay_payment_id;
    const expectedSign = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(sign)
      .digest('hex');
    
    if (razorpay_signature !== expectedSign) {
      return res.status(400).json({ message: 'Invalid payment signature. Payment verification failed.' });
    }
    
    // Payment verified, add tokens to user
    const user = await User.findById(req.user._id);
    const tokensBefore = user.tokens;
    const tokens = parseInt(amount);
    
    user.tokens += tokens;
    await user.save();
    
    // Create transaction record
    const transaction = new Transaction({
      user: user._id,
      type: 'credit',
      tokens,
      description: `Payment via Razorpay (${razorpay_payment_id})`,
      tokensBefore,
      tokensAfter: user.tokens,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id
    });
    await transaction.save();
    
    res.json({
      success: true,
      message: 'Payment verified successfully',
      tokens: user.tokens,
      transaction
    });
  } catch (error) {
    console.error('Verify payment error:', error);
    res.status(500).json({ message: 'Payment verification failed' });
  }
});

// Get user tokens
router.get('/tokens', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('tokens');
    res.json({ tokens: user.tokens });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// Get transaction history
router.get('/transactions', auth, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    
    const transactions = await Transaction.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate('call');

    const total = await Transaction.countDocuments({ user: req.user._id });

    res.json({
      transactions,
      totalPages: Math.ceil(total / limit),
      currentPage: parseInt(page)
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
});

// ===================
// ADMIN ROUTES
// ===================

// Get all users (admin only)
router.get('/admin/all', adminAuth, async (req, res) => {
  try {
    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 });

    res.json(users);
  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get admin statistics (admin only)
router.get('/admin/statistics', adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({ role: 'user' });
    const totalExperts = await Expert.countDocuments();
    const totalCalls = await Call.countDocuments();
    const activeUsers = await User.countDocuments({ status: 'active' });
    const blockedUsers = await User.countDocuments({ status: 'blocked' });
    const suspendedUsers = await User.countDocuments({ status: 'suspended' });
    const onlineUsers = await User.countDocuments({ isOnline: true });
    const verifiedExperts = await Expert.countDocuments({ isVerified: true });
    
    const completedCalls = await Call.countDocuments({ status: 'completed' });
    const totalRevenue = await Call.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$tokensSpent' } } }
    ]);

    const recentUsers = await User.find()
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(5);

    res.json({
      totalUsers,
      totalExperts,
      totalCalls,
      activeUsers,
      blockedUsers,
      suspendedUsers,
      onlineUsers,
      verifiedExperts,
      completedCalls,
      totalRevenue: totalRevenue[0]?.total || 0,
      recentUsers
    });
  } catch (error) {
    console.error('Admin statistics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user status (admin only)
router.put('/admin/:id/status', adminAuth, async (req, res) => {
  try {
    const { status, statusReason } = req.body;

    if (!['active', 'blocked', 'suspended'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status, statusReason: statusReason || '' },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: `User ${status} successfully`,
      user
    });
  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete user (admin only)
router.delete('/admin/:id', adminAuth, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'admin') {
      return res.status(403).json({ message: 'Cannot delete admin users' });
    }

    // If user is an expert, delete their expert profile
    if (user.role === 'expert') {
      await Expert.findOneAndDelete({ user: user._id });
    }

    await User.findByIdAndDelete(req.params.id);

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Block a user
router.post('/block/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;

    if (userId === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot block yourself' });
    }

    const user = await User.findById(req.user._id);
    if (!user.blockedUsers.includes(userId)) {
      user.blockedUsers.push(userId);
      await user.save();
    }

    res.json({ message: 'User blocked successfully' });
  } catch (error) {
    console.error('Block user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Unblock a user
router.post('/unblock/:userId', auth, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(req.user._id);
    user.blockedUsers = user.blockedUsers.filter(id => id.toString() !== userId);
    await user.save();

    res.json({ message: 'User unblocked successfully' });
  } catch (error) {
    console.error('Unblock user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get blocked users
router.get('/blocked', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('blockedUsers', 'name email avatar');
    
    res.json(user.blockedUsers || []);
  } catch (error) {
    console.error('Get blocked users error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get user by ID (public - for caller info in calls)
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId).select('name avatar email role country');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({
      _id: user._id,
      name: user.name,
      avatar: user.avatar,
      email: user.email,
      role: user.role,
      country: user.country
    });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

