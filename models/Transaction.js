const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  type: {
    type: String,
    enum: ['credit', 'debit', 'refund', 'claim'],
    required: true
  },
  tokens: {
    type: Number,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  call: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Call'
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'completed'
  },
  tokensBefore: {
    type: Number,
    required: true
  },
  tokensAfter: {
    type: Number,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

module.exports = mongoose.model('Transaction', transactionSchema);
