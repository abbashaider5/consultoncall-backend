const express = require('express');
const Message = require('../models/Message');
const User = require('../models/User');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get conversation with specific user
router.get('/history/:userId', auth, async (req, res) => {
    try {
        const { page = 1, limit = 50 } = req.query;
        const otherUserId = req.params.userId;
        const currentUserId = req.user._id;

        const messages = await Message.find({
            $or: [
                { sender: currentUserId, receiver: otherUserId },
                { sender: otherUserId, receiver: currentUserId }
            ]
        })
            .sort({ createdAt: -1 }) // Newest first
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .populate('sender', 'name avatar')
            .populate('receiver', 'name avatar');

        // Mark messages from other user as read
        await Message.updateMany(
            { sender: otherUserId, receiver: currentUserId, read: false },
            { read: true, readAt: new Date() }
        );

        res.json({
            success: true,
            messages: messages.reverse(), // Send chronological order to frontend
            page: parseInt(page),
            hasMore: messages.length === parseInt(limit)
        });
    } catch (error) {
        console.error('Get chat history error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Get list of all conversations (cleaner version)
router.get('/conversations', auth, async (req, res) => {
    try {
        const currentUserId = req.user._id;

        // Aggregate to find unique conversation partners and latest message
        const conversations = await Message.aggregate([
            {
                $match: {
                    $or: [{ sender: currentUserId }, { receiver: currentUserId }]
                }
            },
            {
                $sort: { createdAt: -1 }
            },
            {
                $group: {
                    _id: {
                        $cond: [
                            { $eq: ['$sender', currentUserId] },
                            '$receiver',
                            '$sender'
                        ]
                    },
                    lastMessage: { $first: '$$ROOT' },
                    unreadCount: {
                        $sum: {
                            $cond: [
                                { $and: [{ $eq: ['$receiver', currentUserId] }, { $eq: ['$read', false] }] },
                                1,
                                0
                            ]
                        }
                    }
                }
            },
            { $sort: { 'lastMessage.createdAt': -1 } }
        ]);

        // Populate user details
        const populatedConversations = await User.populate(conversations, {
            path: '_id',
            select: 'name avatar role online'
        });

        res.json({
            success: true,
            conversations: populatedConversations.map(c => ({
                user: c._id,
                lastMessage: c.lastMessage,
                unreadCount: c.unreadCount
            }))
        });
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Send a message
router.post('/send', auth, async (req, res) => {
    try {
        const { receiverId, content, type = 'text' } = req.body;

        if (!receiverId || !content) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        // Check blockage
        const sender = await User.findById(req.user._id);
        const receiver = await User.findById(receiverId);

        if (!receiver) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        if (sender.blockedUsers && sender.blockedUsers.includes(receiverId)) {
            return res.status(403).json({ success: false, message: 'You have blocked this user' });
        }

        if (receiver.blockedUsers && receiver.blockedUsers.includes(req.user._id)) {
            return res.status(403).json({ success: false, message: 'You are blocked by this user' });
        }

        const newMessage = new Message({
            sender: req.user._id,
            receiver: receiverId,
            content,
            type
        });

        await newMessage.save();

        const populatedMessage = await newMessage.populate([
            { path: 'sender', select: 'name avatar' },
            { path: 'receiver', select: 'name avatar' }
        ]);

        res.json({
            success: true,
            message: populatedMessage
        });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;
