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

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Handle user joining with nickname
  socket.on('join', (nickname) => {
    // Store user info
    users.set(socket.id, {
      id: socket.id,
      nickname: nickname,
      joinedAt: new Date()
    });

    // Notify all clients about new user
    io.emit('user_connected', {
      nickname: nickname,
      userCount: users.size,
      activeUsers: Array.from(users.values()).map(u => u.nickname)
    });

    // Log to server console
    console.log(`${nickname} joined the chat. Total users: ${users.size}`);

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
      const message = {
        id: Date.now(),
        nickname: user.nickname,
        text: messageData.text,
        timestamp: new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true
        })
      };

      // Broadcast message to all clients
      io.emit('receive_message', message);

      // Log to server console
      console.log(`[${message.timestamp}] ${message.nickname}: ${message.text}`);
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
