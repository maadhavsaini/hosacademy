const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Store active users
const users = new Map();

// Utility function to sanitize HTML/XSS attacks
function sanitizeInput(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .trim();
}

// Utility function to validate and clean nickname
function validateNickname(nickname) {
  if (!nickname || typeof nickname !== 'string') return null;
  const cleaned = nickname.trim();
  if (cleaned.length < 2 || cleaned.length > 20) return null;
  if (!/^[a-zA-Z0-9\s_-]+$/.test(cleaned)) return null;
  return sanitizeInput(cleaned);
}

// Utility function to validate message
function validateMessage(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.trim();
  if (cleaned.length === 0 || cleaned.length > 500) return null;
  return sanitizeInput(cleaned);
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Handle user joining with nickname
  socket.on('join', (nickname) => {
    // Validate and sanitize nickname
    const validatedNickname = validateNickname(nickname);
    if (!validatedNickname) {
      socket.emit('error', { message: 'Invalid nickname' });
      return;
    }

    // Store user info
    users.set(socket.id, {
      id: socket.id,
      nickname: validatedNickname,
      joinedAt: new Date(),
      isTyping: false
    });

    // Notify all clients about new user
    io.emit('user_connected', {
      nickname: validatedNickname,
      userCount: users.size,
      activeUsers: Array.from(users.values()).map(u => u.nickname)
    });

    // Log to server console
    console.log(`${validatedNickname} joined the chat. Total users: ${users.size}`);

    // Send current user list to the newly connected user
    socket.emit('update_users', {
      activeUsers: Array.from(users.values()).map(u => u.nickname)
    });

    // Broadcast to all other users that active users list was updated
    socket.broadcast.emit('update_users', {
      activeUsers: Array.from(users.values()).map(u => u.nickname)
    });
  });

  // Handle incoming messages
  socket.on('send_message', (messageData) => {
    const user = users.get(socket.id);
    if (user) {
      // Validate and sanitize message
      const validatedText = validateMessage(messageData.text);
      if (!validatedText) {
        socket.emit('error', { message: 'Invalid message' });
        return;
      }

      const message = {
        id: Date.now(),
        nickname: user.nickname,
        text: validatedText,
        timestamp: new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        })
      };

      // Clear typing indicator when message is sent
      if (user.isTyping) {
        user.isTyping = false;
        io.emit('user_stop_typing', { nickname: user.nickname });
      }

      // Broadcast message to all clients
      io.emit('receive_message', message);

      // Log to server console
      console.log(`[${message.timestamp}] ${message.nickname}: ${message.text}`);
    }
  });

  // Handle incoming GIF messages
  socket.on('send_gif', (gifData) => {
    const user = users.get(socket.id);
    if (user) {
      // Validate GIF URL (basic check)
      if (!gifData.url || typeof gifData.url !== 'string' || !gifData.url.startsWith('http')) {
        socket.emit('error', { message: 'Invalid GIF' });
        return;
      }

      // Limit URL length to prevent abuse
      if (gifData.url.length > 500) {
        socket.emit('error', { message: 'GIF URL too long' });
        return;
      }

      const gifTitle = (gifData.title || 'GIF').substring(0, 100);

      const message = {
        id: Date.now(),
        nickname: user.nickname,
        text: gifTitle,
        gifUrl: gifData.url,
        timestamp: new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        })
      };

      // Clear typing indicator when GIF is sent
      if (user.isTyping) {
        user.isTyping = false;
        io.emit('user_stop_typing', { nickname: user.nickname });
      }

      // Broadcast GIF to all clients
      io.emit('receive_gif', message);

      // Log to server console
      console.log(`[${message.timestamp}] ${message.nickname} sent a GIF: ${gifTitle}`);
    }
  });

  // Handle typing indicator
  socket.on('user_typing', () => {
    const user = users.get(socket.id);
    if (user) {
      user.isTyping = true;
      socket.broadcast.emit('user_typing', { nickname: user.nickname });
    }
  });

  // Handle stop typing
  socket.on('user_stop_typing', () => {
    const user = users.get(socket.id);
    if (user) {
      user.isTyping = false;
      socket.broadcast.emit('user_stop_typing', { nickname: user.nickname });
    }
  });

  // Handle user disconnection
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const nickname = user.nickname;
      users.delete(socket.id);

      // Notify all clients about user disconnection
      io.emit('user_disconnected', {
        nickname: nickname,
        userCount: users.size,
        activeUsers: Array.from(users.values()).map(u => u.nickname)
      });

      // Update all remaining users about the current active users list
      io.emit('update_users', {
        activeUsers: Array.from(users.values()).map(u => u.nickname)
      });

      console.log(`${nickname} left the chat. Total users: ${users.size}`);
    }
  });

  // Handle errors
  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

// Server configuration
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`\n================================================`);
  console.log(`🚀 Real-time Chat Server Started`);
  console.log(`================================================`);
  console.log(`Server running at: http://localhost:${PORT}`);
  console.log(`Open your browser and navigate to http://localhost:${PORT}`);
  console.log(`================================================\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
