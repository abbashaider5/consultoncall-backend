const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  caller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  expert: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Expert',
    required: true
  },
  status: {
    type: String,
    enum: ['initiated', 'ringing', 'ongoing', 'completed', 'missed', 'rejected', 'failed'],
    default: 'initiated'
  },
  startTime: {
    type: Date
  },
  endTime: {
    type: Date
  },
  duration: {
    type: Number, // Duration in seconds
    default: 0
  },
  tokensPerMinute: {
    type: Number,
    required: true
  },
  tokensSpent: {
    type: Number,
    default: 0
  },
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  review: {
    type: String,
    maxlength: 500
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Calculate tokens spent based on duration
callSchema.methods.calculateTokens = function() {
  if (this.duration > 0) {
    const minutes = Math.ceil(this.duration / 60);
    this.tokensSpent = minutes * this.tokensPerMinute;
  }
  return this.tokensSpent;
};

module.exports = mongoose.model('Call', callSchema);
