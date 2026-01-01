const mongoose = require('mongoose');

const expertSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  bio: {
    type: String,
    required: true,
    maxlength: 1000
  },
  banner: {
    type: String,
    default: ''
  },
  categories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  tokensPerMinute: {
    type: Number,
    required: true,
    min: 1
  },
  experience: {
    type: Number,
    default: 0
  },
  skills: [{
    type: String,
    trim: true
  }],
  languages: [{
    type: String,
    trim: true
  }],
  country: {
    type: String,
    trim: true
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalRatings: {
    type: Number,
    default: 0
  },
  satisfiedCustomers: {
    type: Number,
    default: 0
  },
  totalCalls: {
    type: Number,
    default: 0
  },
  totalMinutes: {
    type: Number,
    default: 0
  },
  tokensEarned: {
    type: Number,
    default: 0
  },
  tokensClaimed: {
    type: Number,
    default: 0
  },
  unclaimedTokens: {
    type: Number,
    default: 0
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isApproved: {
    type: Boolean,
    default: false
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  },
  rejectionReason: {
    type: String,
    default: ''
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  isOnline: {
    type: Boolean,
    default: false
  },
  isBusy: {
    type: Boolean,
    default: false
  },
  currentCallId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Call'
  },
  linkedinId: {
    type: String,
    default: ''
  },
  linkedinProfileUrl: {
    type: String,
    default: ''
  },
  linkedinVerified: {
    type: Boolean,
    default: false
  },
  profileSource: {
    type: String,
    enum: ['manual', 'linkedin'],
    default: 'manual'
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

module.exports = mongoose.model('Expert', expertSchema);
