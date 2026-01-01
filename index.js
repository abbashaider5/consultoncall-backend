require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const passport = require('./config/passport');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const expertRoutes = require('./routes/experts');
// const adminRoutes = require('./routes/admin'); // File does not exist yet
const callRoutes = require('./routes/calls');
const chatRoutes = require('./routes/chats'); // Switching to chats.js (has get-or-create)
const categoryRoutes = require('./routes/categories');

// Ensure models are registered
require('./models/User');
require('./models/Expert');
require('./models/Category');
require('./models/Call');
require('./models/Transaction');
require('./models/Chat');

const app = express();

/* ===============================
   CORS – PRODUCTION GRADE CONFIGURATION
   ⚠️ CRITICAL: Never throw errors in CORS callback
   ✅ Always return CORS headers, even on errors
   ================================ */

const allowedOrigins = [
  'http://localhost:3000',
  'https://abbaslogic.com',
  'https://www.abbaslogic.com',
  'https://api.abbaslogic.com'
];

// CORS Configuration - TEMPORARILY PERMISSIVE
const corsOptions = {
  origin: (origin, callback) => {
    console.log(`🔍 CORS Check - Origin: ${origin}`);
    // TEMP: Allow ALL origins
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-auth-token'],
  exposedHeaders: ['Content-Length', 'X-JSON'],
  maxAge: 86400, // 24 hours - cache preflight
  optionsSuccessStatus: 200 // For legacy browsers
};

// Apply CORS middleware
app.use(cors(corsOptions));

// ✅ Explicit preflight handler - ensures OPTIONS always returns 200
app.options('*', cors(corsOptions));

// ✅ Fallback CORS headers middleware - ensures headers on ALL responses
app.use((req, res, next) => {
  const origin = req.headers.origin;

  // TEMP: Set CORS headers for ALL origins
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, x-auth-token');

  next();
});

/* ===============================
   MIDDLEWARES
================================ */

app.use(express.json({ limit: '10mb' }));

// Session middleware (required for OAuth state management)
app.use(session({
  secret: process.env.SESSION_SECRET || 'consultoncall-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(passport.initialize());
app.use(passport.session());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

/* ===============================
   MONGODB (VERCEL SAFE)
================================ */

let cachedConnection = null;

async function connectDB() {
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }

  try {
    cachedConnection = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000
    });

    console.log('✅ MongoDB connected');
    return cachedConnection;
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err);
    throw err;
  }
}

// Initial connect - don't crash server if it fails
connectDB().catch(err => {
  console.error('❌ Initial MongoDB connection failed:', err.message);
  // Don't throw - let the server start and handle reconnections
});

// Reconnect if disconnected
mongoose.connection.on('disconnected', () => {
  console.warn('⚠️ MongoDB disconnected, retrying...');
  setTimeout(connectDB, 5000);
});

/* ===============================
   HEALTH & TEST ROUTES
================================ */

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    mongodb:
      mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/test', (req, res) => {
  res.json({
    success: true,
    message: 'API working correctly',
    timestamp: new Date().toISOString()
  });
});

/* ===============================
   API ROUTES
================================ */

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/experts', expertRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/chats', chatRoutes);
// app.use('/api/admin', adminRoutes);

/* ===============================
   GLOBAL ERROR HANDLER
   ✅ ALWAYS returns CORS headers, even on errors
================================ */

app.use((err, req, res, next) => {
  console.error('🔥 API ERROR:', err.message);
  console.error('Stack:', err.stack);

  // ✅ TEMP: Always set CORS headers on error responses for ALL origins
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, x-auth-token');

  // Return structured error
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

/* ===============================
   SERVER (LOCAL ONLY)
================================ */

const PORT = process.env.PORT || 5000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 REST API running on port ${PORT}`);
  });
}

module.exports = app;
