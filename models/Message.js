const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    receiver: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    content: {
        type: String,
        required: true,
        trim: true
    },
    attachments: [{
        type: String, // URL to file
        name: String
    }],
    read: {
        type: Boolean,
        default: false
    },
    readAt: {
        type: Date
    },
    type: {
        type: String,
        enum: ['text', 'image', 'system'],
        default: 'text'
    }
}, {
    timestamps: true
});

// Index for efficient querying of conversation history
messageSchema.index({ sender: 1, receiver: 1, createdAt: -1 });
messageSchema.index({ receiver: 1, sender: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
