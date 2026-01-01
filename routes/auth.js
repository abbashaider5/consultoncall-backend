const express = require('express');
const jwt = require('jsonwebtoken');
const passport = require('../config/passport');
const User = require('../models/User');
const Expert = require('../models/Expert');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Register user
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Create new user
    const user = new User({
      name,
      email,
      password,
      phone,
      role: role || 'user'
    });

    await user.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        tokens: user.tokens
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// Register as expert
router.post('/register-expert', async (req, res) => {
  try {
    const { name, email, password, phone, title, bio, categories, tokensPerMinute, experience, skills, languages } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Create new user as expert
    const user = new User({
      name,
      email,
      password,
      phone,
      role: 'expert'
    });

    await user.save();

    // Create expert profile
    const expert = new Expert({
      user: user._id,
      title,
      bio,
      categories: categories || [],
      tokensPerMinute,
      experience: experience || 0,
      skills: skills || [],
      languages: languages || ['English']
    });

    await expert.save();

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'Expert registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        tokens: user.tokens
      },
      expert: {
        id: expert._id,
        title: expert.title,
        tokensPerMinute: expert.tokensPerMinute
      }
    });
  } catch (error) {
    console.error('Expert registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }
    // Check if user is blocked or suspended
    if (user.status === 'blocked' || user.status === 'suspended') {
      return res.status(403).json({ 
        message: `Your account has been ${user.status}.`,
        reason: user.statusReason || 'Please contact support for more information.'
      });
    }
    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // If expert, get expert profile
    let expertProfile = null;
    if (user.role === 'expert') {
      expertProfile = await Expert.findOne({ user: user._id }).populate('categories');
    }

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        tokens: user.tokens,
        avatar: user.avatar
      },
      expert: expertProfile
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// Get current user
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    
    let expertProfile = null;
    if (user.role === 'expert') {
      expertProfile = await Expert.findOne({ user: user._id }).populate('categories');
    }

    res.json({
      user,
      expert: expertProfile
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Google OAuth Routes
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

router.get('/google/callback', 
  passport.authenticate('google', { session: false, failureRedirect: `${process.env.NODE_ENV === 'production' ? 'https://abbaslogic.com' : 'http://localhost:3000'}/login?error=google_failed` }),
  async (req, res) => {
    try {
      const user = req.user;
      
      // Check if user is blocked or suspended
      if (user.status === 'blocked' || user.status === 'suspended') {
        const frontendURL = process.env.NODE_ENV === 'production' 
          ? 'https://abbaslogic.com'
          : 'http://localhost:3000';
        return res.redirect(`${frontendURL}/login?error=account_${user.status}`);
      }
      
      const token = jwt.sign(
        { userId: user._id },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      // Redirect to frontend with token
      const frontendURL = process.env.NODE_ENV === 'production' 
        ? 'https://abbaslogic.com'
        : 'http://localhost:3000';
      res.redirect(`${frontendURL}/oauth/callback?token=${token}`);
    } catch (error) {
      console.error('Google OAuth callback error:', error);
      res.redirect('/login?error=oauth_failed');
    }
  }
);

// LinkedIn OAuth Routes
router.get('/linkedin', passport.authenticate('linkedin', {
  scope: ['openid', 'profile', 'email']
}));

router.get('/linkedin/callback',
  passport.authenticate('linkedin', { session: false, failureRedirect: `${process.env.NODE_ENV === 'production' ? 'https://abbaslogic.com' : 'http://localhost:3000'}/login?error=linkedin_failed` }),
  async (req, res) => {
    try {
      const { user, expert } = req.user;
      const token = jwt.sign(
        { userId: user._id },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      // Redirect to appropriate dashboard based on role
      const redirectPath = user.role === 'expert' ? '/expert-dashboard' : '/dashboard';
      const frontendURL = process.env.NODE_ENV === 'production' 
        ? 'https://abbaslogic.com'
        : 'http://localhost:3000';
      res.redirect(`${frontendURL}/oauth/callback?token=${token}&redirect=${redirectPath}`);
    } catch (error) {
      console.error('LinkedIn OAuth callback error:', error);
      res.redirect('/login?error=oauth_failed');
    }
  }
);

module.exports = router;
