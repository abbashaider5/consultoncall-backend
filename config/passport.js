const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const LinkedInStrategy = require('passport-linkedin-oauth2').Strategy;
const User = require('../models/User');
const Expert = require('../models/Expert');

// Passport serialize/deserialize (required for session)
passport.serializeUser((user, done) => {
  done(null, user._id || user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const User = require('../models/User');
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Google OAuth Strategy - only initialize if credentials are set
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_ID !== 'placeholder') {
  const callbackURL = process.env.GOOGLE_CALLBACK_URL || 
    (process.env.NODE_ENV === 'production' 
      ? 'https://api.abbaslogic.com/api/auth/google/callback'
      : 'http://localhost:5000/api/auth/google/callback');
  
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: callbackURL,
    scope: ['profile', 'email']
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      // Check if user exists with Google ID
      let user = await User.findOne({ googleId: profile.id });
      
      if (user) {
        return done(null, user);
      }
      
      // Check if user exists with same email
      user = await User.findOne({ email: profile.emails[0].value });
      
      if (user) {
        // Link Google account to existing user
        user.googleId = profile.id;
        user.authProvider = user.authProvider === 'local' ? 'local' : 'google';
        if (!user.avatar && profile.photos[0]?.value) {
          user.avatar = profile.photos[0].value;
        }
        await user.save();
        return done(null, user);
      }
      
      // Create new user
      user = new User({
        name: profile.displayName,
        email: profile.emails[0].value,
        googleId: profile.id,
        avatar: profile.photos[0]?.value || '',
        authProvider: 'google',
        role: 'user'
      });
      
      await user.save();
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  }));
  console.log('Google OAuth Strategy initialized');
} else {
  console.log('Google OAuth Strategy not configured - skipping');
}

// LinkedIn OAuth Strategy - ALWAYS initialize for production
// Credentials MUST be set in environment variables
console.log('🔗 Initializing LinkedIn OAuth strategy...');
console.log('LINKEDIN_CLIENT_ID:', process.env.LINKEDIN_CLIENT_ID ? 'Set' : 'Not set');
console.log('LINKEDIN_CLIENT_SECRET:', process.env.LINKEDIN_CLIENT_SECRET ? 'Set' : 'Not set');

if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET) {
  console.error('⚠️ WARNING: LinkedIn OAuth credentials not configured!');
  console.error('Set LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in environment variables');
} else {
  const callbackURL = process.env.NODE_ENV === 'production' 
    ? 'https://api.abbaslogic.com/api/auth/linkedin/callback'
    : 'http://localhost:5000/api/auth/linkedin/callback';
  
  console.log('LinkedIn Callback URL:', callbackURL);
  
  passport.use('linkedin', new LinkedInStrategy({
    clientID: process.env.LINKEDIN_CLIENT_ID,
    clientSecret: process.env.LINKEDIN_CLIENT_SECRET,
    callbackURL: callbackURL,
    scope: ['openid', 'profile', 'email'],
    state: true
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      console.log('✅ LinkedIn OAuth callback received');
      // Check if user exists with LinkedIn ID
      let user = await User.findOne({ linkedinId: profile.id });
      
      if (user) {
        // If user exists, check if they have expert profile
        const expert = await Expert.findOne({ user: user._id });
        return done(null, { user, expert });
      }
      
      // Check if user exists with same email
      const email = profile.emails?.[0]?.value;
      if (email) {
        user = await User.findOne({ email });
        
        if (user) {
          // Link LinkedIn account to existing user
          user.linkedinId = profile.id;
          user.authProvider = user.authProvider === 'local' ? 'local' : 'linkedin';
          
          // Update profile data if not manually set
          if (!user.avatar || user.profileSource !== 'manual') {
            user.avatar = profile.photos?.[0]?.value || user.avatar;
          }
          if (!user.bio || user.profileSource !== 'manual') {
            user.bio = profile._json?.summary || user.bio;
          }
          
          await user.save();
          
          // Check if expert profile exists
          const expert = await Expert.findOne({ user: user._id });
          if (expert) {
            // Update expert LinkedIn data
            expert.linkedinId = profile.id;
            expert.linkedinProfileUrl = profile._json?.publicProfileUrl || '';
            expert.linkedinVerified = true;
            expert.profileSource = 'linkedin';
            
            // Update expert title if not manually set
            if (!expert.title || expert.profileSource !== 'manual') {
              expert.title = profile._json?.headline || expert.title;
            }
            
            await expert.save();
          }
          
          return done(null, { user, expert });
        }
      }
      
      // Create new expert user
      user = new User({
        name: profile.displayName,
        email: email || `linkedin_${profile.id}@placeholder.com`,
        linkedinId: profile.id,
        avatar: profile.photos?.[0]?.value || '',
        authProvider: 'linkedin',
        role: 'expert',
        bio: profile._json?.summary || '',
        profileSource: 'linkedin'
      });
      
      await user.save();
      
      // Create expert profile
      const expert = new Expert({
        user: user._id,
        title: profile._json?.headline || 'Expert Consultant',
        bio: profile._json?.summary || 'Professional consultant verified via LinkedIn',
        tokensPerMinute: 2, // Default rate
        linkedinId: profile.id,
        linkedinProfileUrl: profile._json?.publicProfileUrl || '',
        linkedinVerified: true,
        profileSource: 'linkedin',
        isApproved: true, // Auto-approve LinkedIn verified experts
        approvedAt: new Date()
      });
      
      await expert.save();
      
      done(null, { user, expert });
    } catch (error) {
      console.error('❌ LinkedIn OAuth callback error:', error);
      done(error, null);
    }
  }));
  console.log('✅ LinkedIn OAuth Strategy initialized successfully');
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

module.exports = passport;
