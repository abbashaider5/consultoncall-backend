const express = require('express');
const Chat = require('../models/Chat');
const User = require('../models/User');
const Expert = require('../models/Expert');
const { auth } = require('../middleware/auth');

const router = express.Router();

// Get all chats for the authenticated user
router.get('/', auth, async (req, res) => {
  try {
    const chats = await Chat.find({
      participants: req.user._id
    })
      .populate('participants', 'name avatar email role')
      .populate('expert', 'expertise rating')
      .sort({ lastMessageTime: -1 });

    res.json(chats);
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get or create a chat with another user
router.post('/get-or-create', auth, async (req, res) => {
  try {
    const { participantId } = req.body;

    if (!participantId) {
      return res.status(400).json({ message: 'Participant ID required' });
    }

    // Check if the other user has blocked the current user
    const otherUser = await User.findById(participantId);
    if (otherUser && otherUser.blockedUsers && otherUser.blockedUsers.includes(req.user._id)) {
      return res.status(403).json({ message: 'You cannot chat with this user' });
    }

    // Check if current user has blocked the other user
    const currentUser = await User.findById(req.user._id);
    if (currentUser && currentUser.blockedUsers && currentUser.blockedUsers.includes(participantId)) {
      return res.status(403).json({ message: 'You have blocked this user' });
    }

    // Find existing chat or create new one
    let chat = await Chat.findOne({
      participants: { $all: [req.user._id, participantId] }
    })
      .populate('participants', 'name avatar email role')
      .populate('expert', 'expertise rating');

    if (!chat) {
      // Check if participantId is an expert
      const expert = await Expert.findOne({ user: participantId });
      
      chat = new Chat({
        participants: [req.user._id, participantId],
        messages: [],
        expert: expert ? expert._id : null
      });
      await chat.save();
      
      // Populate the newly created chat
      chat = await Chat.findById(chat._id)
        .populate('participants', 'name avatar email role')
        .populate('expert', 'expertise rating');
    }

    res.json(chat);
  } catch (error) {
    console.error('Error creating/fetching chat:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get messages for a specific chat
router.get('/:chatId/messages', auth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { page = 1, limit = 50 } = req.query;

    const chat = await Chat.findOne({
      _id: chatId,
      participants: req.user._id
    });

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Get paginated messages
    const skip = (page - 1) * limit;
    const messages = chat.messages
      .slice(-skip - parseInt(limit), chat.messages.length - skip)
      .reverse();

    res.json({
      messages,
      hasMore: chat.messages.length > skip + parseInt(limit)
    });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Send a message
router.post('/:chatId/messages', auth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Message content required' });
    }

    const chat = await Chat.findOne({
      _id: chatId,
      participants: req.user._id
    });

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Check if any participant has blocked the other
    const otherParticipantId = chat.participants.find(
      id => id.toString() !== req.user._id.toString()
    );

    const otherUser = await User.findById(otherParticipantId);
    const currentUser = await User.findById(req.user._id);

    if (otherUser && otherUser.blockedUsers && otherUser.blockedUsers.includes(req.user._id)) {
      return res.status(403).json({ message: 'You cannot send messages to this user' });
    }

    if (currentUser && currentUser.blockedUsers && currentUser.blockedUsers.includes(otherParticipantId)) {
      return res.status(403).json({ message: 'You have blocked this user' });
    }

    const message = {
      sender: req.user._id,
      content: content.trim(),
      read: false,
      createdAt: new Date()
    };

    chat.messages.push(message);
    chat.lastMessage = content.trim();
    chat.lastMessageTime = new Date();
    await chat.save();

    res.json(message);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Mark messages as read
router.put('/:chatId/read', auth, async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await Chat.findOne({
      _id: chatId,
      participants: req.user._id
    });

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    // Mark all messages from other participants as read
    chat.messages.forEach(msg => {
      if (msg.sender.toString() !== req.user._id.toString() && !msg.read) {
        msg.read = true;
      }
    });

    await chat.save();
    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete a chat
router.delete('/:chatId', auth, async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await Chat.findOneAndDelete({
      _id: chatId,
      participants: req.user._id
    });

    if (!chat) {
      return res.status(404).json({ message: 'Chat not found' });
    }

    res.json({ message: 'Chat deleted successfully' });
  } catch (error) {
    console.error('Error deleting chat:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
