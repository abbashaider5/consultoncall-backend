const jwt = require('jsonwebtoken');
const User = require('../models/User');

const auth = async (req, res, next) => {
  try {
    // Check both Authorization header and x-auth-token for compatibility
    let token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      token = req.header('x-auth-token');
    }
    
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token, authorization denied' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Token is not valid' });
    }

    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    // Check if user is blocked or suspended
    if (user.status === 'blocked' || user.status === 'suspended') {
      return res.status(403).json({ 
        success: false,
        message: `Your account has been ${user.status}.`,
        reason: user.statusReason || 'Please contact support for more information.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ success: false, message: 'Authentication error' });
  }
};

const expertAuth = async (req, res, next) => {
  auth(req, res, (err) => {
    if (err) return;
    
    if (req.user.role !== 'expert' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied. Experts only.' });
    }
    next();
  });
};

const adminAuth = async (req, res, next) => {
  auth(req, res, (err) => {
    if (err) return;
    
    if (req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied. Admins only.' });
    }
    next();
  });
};

module.exports = { auth, expertAuth, adminAuth };
