require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');

// Import models
const User = require('./models/User');
const Expert = require('./models/Expert');
const Call = require('./models/Call');
const Transaction = require('./models/Transaction');
const Chat = require('./models/Chat');

const app = express();
const server = http.createServer(app);

// Socket.IO setup with CORS
const io = socketIo(server, {
  cors: {
    origin: [
      "http://localhost:3000",
      "https://consultoncall-frontend.vercel.app",
      "https://consultoncall.vercel.app"
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/consultoncall', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('MongoDB connected for socket server'))
.catch(err => console.error('MongoDB connection error:', err));

// Store active connections
const activeUsers = new Map(); // userId -> socketId
const activeExperts = new Map(); // expertId -> socketId
const activeCalls = new Map(); // callId -> { callerSocketId, expertSocketId, status }

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // User authentication and registration
  socket.on('register_user', (data) => {
    const { userId, isExpert } = data;
    console.log(`User ${userId} registered as ${isExpert ? 'expert' : 'user'}`);

    if (isExpert) {
      activeExperts.set(userId, socket.id);
      socket.join(`expert_${userId}`);
    } else {
      activeUsers.set(userId, socket.id);
      socket.join(`user_${userId}`);
    }

    socket.userId = userId;
    socket.isExpert = isExpert;
  });

  // Handle call request from user to expert
  socket.on('call_request', async (data, callback) => {
    try {
      const { callerId, expertId, callId } = data;
      console.log(`Call request: ${callerId} -> ${expertId}, callId: ${callId}`);

      const expertSocketId = activeExperts.get(expertId);
      if (!expertSocketId) {
        console.log(`Expert ${expertId} not online`);
        callback({ success: false, message: 'Expert not available' });
        return;
      }

      // Store call info
      activeCalls.set(callId, {
        callerId,
        expertId,
        callerSocketId: socket.id,
        expertSocketId,
        status: 'ringing'
      });

      // Notify expert
      io.to(expertSocketId).emit('incoming_call', {
        callId,
        callerId,
        expertId
      });

      callback({ success: true });
    } catch (error) {
      console.error('Call request error:', error);
      callback({ success: false, message: 'Internal server error' });
    }
  });

  // Expert accepts call
  socket.on('call_accept', async (data, callback) => {
    try {
      const { callId, callerId, expertId } = data;
      console.log(`Call accepted: ${callId}`);

      const callInfo = activeCalls.get(callId);
      if (!callInfo) {
        callback({ success: false, message: 'Call not found' });
        return;
      }

      callInfo.status = 'accepted';

      // Notify caller
      io.to(callInfo.callerSocketId).emit('call_accepted', {
        callId,
        expertId
      });

      callback({ success: true });
    } catch (error) {
      console.error('Call accept error:', error);
      callback({ success: false, message: 'Internal server error' });
    }
  });

  // Expert rejects call
  socket.on('call_reject', async (data, callback) => {
    try {
      const { callId, callerId } = data;
      console.log(`Call rejected: ${callId}`);

      const callInfo = activeCalls.get(callId);
      if (!callInfo) {
        callback({ success: false, message: 'Call not found' });
        return;
      }

      // Notify caller
      io.to(callInfo.callerSocketId).emit('call_rejected', {
        callId
      });

      // Clean up
      activeCalls.delete(callId);

      callback({ success: true });
    } catch (error) {
      console.error('Call reject error:', error);
      callback({ success: false, message: 'Internal server error' });
    }
  });

  // Call connected (after WebRTC handshake)
  socket.on('call_connected', async (data, callback) => {
    try {
      const { callId } = data;
      console.log(`Call connected: ${callId}`);

      const callInfo = activeCalls.get(callId);
      if (!callInfo) {
        callback({ success: false, message: 'Call not found' });
        return;
      }

      callInfo.status = 'connected';

      // Notify both parties
      io.to(callInfo.callerSocketId).emit('call_connected', { callId });
      io.to(callInfo.expertSocketId).emit('call_connected', { callId });

      callback({ success: true });
    } catch (error) {
      console.error('Call connected error:', error);
      callback({ success: false, message: 'Internal server error' });
    }
  });

  // End call
  socket.on('call_end', async (data, callback) => {
    try {
      const { callId } = data;
      console.log(`Call ended: ${callId}`);

      const callInfo = activeCalls.get(callId);
      if (callInfo) {
        // Notify other party
        const otherSocketId = socket.id === callInfo.callerSocketId
          ? callInfo.expertSocketId
          : callInfo.callerSocketId;

        io.to(otherSocketId).emit('call_ended', { callId });

        // Clean up
        activeCalls.delete(callId);
      }

      callback({ success: true });
    } catch (error) {
      console.error('Call end error:', error);
      callback({ success: false, message: 'Internal server error' });
    }
  });

  // WebRTC signaling
  socket.on('webrtc_offer', (data) => {
    const { callId, offer } = data;
    const callInfo = activeCalls.get(callId);
    if (callInfo) {
      const targetSocketId = socket.id === callInfo.callerSocketId
        ? callInfo.expertSocketId
        : callInfo.callerSocketId;
      io.to(targetSocketId).emit('webrtc_offer', { callId, offer });
    }
  });

  socket.on('webrtc_answer', (data) => {
    const { callId, answer } = data;
    const callInfo = activeCalls.get(callId);
    if (callInfo) {
      const targetSocketId = socket.id === callInfo.callerSocketId
        ? callInfo.expertSocketId
        : callInfo.callerSocketId;
      io.to(targetSocketId).emit('webrtc_answer', { callId, answer });
    }
  });

  socket.on('webrtc_ice', (data) => {
    const { callId, candidate } = data;
    const callInfo = activeCalls.get(callId);
    if (callInfo) {
      const targetSocketId = socket.id === callInfo.callerSocketId
        ? callInfo.expertSocketId
        : callInfo.callerSocketId;
      io.to(targetSocketId).emit('webrtc_ice', { callId, candidate });
    }
  });

  // Chat socket handlers
  socket.on('join_chat', async (data) => {
    const { chatId } = data;
    socket.join(`chat_${chatId}`);
    console.log(`User ${socket.userId} joined chat: ${chatId}`);
  });

  socket.on('leave_chat', (data) => {
    const { chatId } = data;
    socket.leave(`chat_${chatId}`);
    console.log(`User ${socket.userId} left chat: ${chatId}`);
  });

  socket.on('send_message', async (data) => {
    const { chatId, message } = data;
    console.log(`Message in chat ${chatId}:`, message);

    // Broadcast message to all users in the chat room
    socket.to(`chat_${chatId}`).emit('new_message', {
      chatId,
      message,
      timestamp: new Date()
    });
  });

  socket.on('mark_read', (data) => {
    const { chatId } = data;
    // Notify other participants that messages have been read
    socket.to(`chat_${chatId}`).emit('message_read', {
      chatId,
      userId: socket.userId
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);

    if (socket.userId) {
      if (socket.isExpert) {
        activeExperts.delete(socket.userId);
      } else {
        activeUsers.delete(socket.userId);
      }

      // End any active calls for this user
      for (const [callId, callInfo] of activeCalls.entries()) {
        if (callInfo.callerSocketId === socket.id || callInfo.expertSocketId === socket.id) {
          const otherSocketId = callInfo.callerSocketId === socket.id
            ? callInfo.expertSocketId
            : callInfo.callerSocketId;

          io.to(otherSocketId).emit('call_ended', { callId });
          activeCalls.delete(callId);
        }
      }
    }
  });
});

const PORT = process.env.SOCKET_PORT || 3001;
server.listen(PORT, () => {
  console.log(`Socket server running on port ${PORT}`);
});