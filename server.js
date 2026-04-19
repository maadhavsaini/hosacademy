require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const { Groq } = require('groq-sdk');

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

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY
});

// Store active users
const users = new Map();

// Message types
const MESSAGE_TYPE = {
  TEXT: 'text',
  GIF: 'gif'
};

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Sanitize HTML to prevent XSS
 * Removes HTML tags but preserves special characters since we use textContent
 */
function sanitizeInput(text) {
  if (typeof text !== 'string') return '';
  // Remove HTML tags but keep special characters as-is
  // textContent is safe from XSS and won't parse HTML entities
  return text
    .replace(/<[^>]*>/g, '')  // Remove HTML tags
    .trim();
}

/**
 * Validate and clean nickname
 */
function validateNickname(nickname) {
  if (!nickname || typeof nickname !== 'string') return null;
  const cleaned = nickname.trim();
  if (cleaned.length < 2 || cleaned.length > 20) return null;
  if (!/^[a-zA-Z0-9\s_-]+$/.test(cleaned)) return null;
  return sanitizeInput(cleaned);
}

/**
 * Validate text message
 */
function validateTextMessage(text) {
  if (!text || typeof text !== 'string') return null;
  const cleaned = text.trim();
  if (cleaned.length === 0 || cleaned.length > 500) return null;
  return sanitizeInput(cleaned);
}

/**
 * Validate GIF URL
 */
function validateGifUrl(url) {
  if (!url || typeof url !== 'string') return null;
  // Must be HTTPS
  if (!url.startsWith('https://')) return null;
  // Must be a reasonable length
  if (url.length > 500) return null;
  // Basic URL validation
  try {
    new URL(url);
    return url;
  } catch (e) {
    return null;
  }
}

/**
 * Format timestamp
 */
function formatTimestamp() {
  return new Date().toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

/**
 * Call Groq API to get bot response
 */
async function getBotResponse(query) {
  try {
    const message = await groq.messages.create({
      model: 'llama3-8b-8192',
      max_tokens: 256,
      messages: [
        {
          role: 'user',
          content: query
        }
      ],
      system: 'You are a fun, slightly unhinged AI bot named epstein participating in a group chat. Keep responses brief (1-2 sentences max), funny, and casual. You love emojis and internet culture.'
    });

    // Extract the text from the response
    return message.content[0].type === 'text' ? message.content[0].text : 'Did not compute.';
  } catch (error) {
    console.error('Groq API error:', error);
    return 'My brain hurts, try again later. 🤖';
  }
}

// ========================================
// SOCKET.IO CONNECTION HANDLING
// ========================================

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  /**
   * Handle user joining with nickname
   */
  socket.on('join', (nickname) => {
    const validatedNickname = validateNickname(nickname);
    if (!validatedNickname) {
      socket.emit('error', { message: 'Invalid nickname' });
      return;
    }

    users.set(socket.id, {
      id: socket.id,
      nickname: validatedNickname,
      joinedAt: new Date(),
      isTyping: false
    });

    const activeUsers = Array.from(users.values()).map(u => u.nickname);

    io.emit('user_connected', {
      nickname: validatedNickname,
      userCount: users.size,
      activeUsers: activeUsers
    });

    console.log(`${validatedNickname} joined. Total users: ${users.size}`);

    socket.emit('update_users', { activeUsers });
    socket.broadcast.emit('update_users', { activeUsers });
  });

  /**
   * Handle incoming messages (both text and GIF)
   */
  socket.on('send_message', async (messageData) => {
    const user = users.get(socket.id);
    if (!user) {
      socket.emit('error', { message: 'User not found' });
      return;
    }

    // Validate message structure
    if (!messageData || !messageData.type) {
      socket.emit('error', { message: 'Invalid message format' });
      return;
    }

    let message = {
      id: Date.now(),
      nickname: user.nickname,
      timestamp: formatTimestamp(),
      type: messageData.type
    };

    // Handle text messages
    if (messageData.type === MESSAGE_TYPE.TEXT) {
      const validatedText = validateTextMessage(messageData.content);
      if (!validatedText) {
        socket.emit('error', { message: 'Invalid message content' });
        return;
      }
      message.content = validatedText;

      // Check if message starts with /epstein command
      if (validatedText.startsWith('/epstein ')) {
        // Broadcast the original user message first
        io.emit('receive_message', message);

        // Extract the query
        const query = validatedText.substring('/epstein '.length).trim();

        if (query.length === 0) {
          // Send error message from bot
          const errorBotMessage = {
            id: Date.now() + 1,
            nickname: 'epstein',
            timestamp: formatTimestamp(),
            type: MESSAGE_TYPE.TEXT,
            content: 'Hey! You gotta ask me something. /epstein [your question]'
          };
          io.emit('receive_message', errorBotMessage);
          return;
        }

        // Get response from Groq API
        const botResponse = await getBotResponse(query);

        // Send bot response
        const botMessage = {
          id: Date.now() + 1,
          nickname: 'epstein',
          timestamp: formatTimestamp(),
          type: MESSAGE_TYPE.TEXT,
          content: botResponse
        };

        io.emit('receive_message', botMessage);
        console.log(`[${botMessage.timestamp}] epstein: ${botResponse}`);
        return;
      }

      // Broadcast normal text message
      io.emit('receive_message', message);
    }
    // Handle GIF messages
    else if (messageData.type === MESSAGE_TYPE.GIF) {
      const validatedUrl = validateGifUrl(messageData.content);
      if (!validatedUrl) {
        socket.emit('error', { message: 'Invalid GIF URL' });
        return;
      }
      message.content = validatedUrl;
      message.title = (messageData.title || 'GIF').substring(0, 100);

      // Broadcast GIF message
      io.emit('receive_message', message);
    }
    // Handle unknown message types
    else {
      socket.emit('error', { message: 'Unknown message type' });
      return;
    }

    // Clear typing indicator
    if (user.isTyping) {
      user.isTyping = false;
      io.emit('user_stop_typing', { nickname: user.nickname });
    }

    // Log to console
    console.log(`[${message.timestamp}] ${message.nickname} (${message.type}): ${message.content.substring(0, 50)}...`);
  });

  /**
   * Handle typing indicator
   */
  socket.on('user_typing', () => {
    const user = users.get(socket.id);
    if (user) {
      user.isTyping = true;
      socket.broadcast.emit('user_typing', { nickname: user.nickname });
    }
  });

  /**
   * Handle stop typing
   */
  socket.on('user_stop_typing', () => {
    const user = users.get(socket.id);
    if (user) {
      user.isTyping = false;
      socket.broadcast.emit('user_stop_typing', { nickname: user.nickname });
    }
  });

  /**
   * Handle user disconnection
   */
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const nickname = user.nickname;
      users.delete(socket.id);

      const activeUsers = Array.from(users.values()).map(u => u.nickname);

      io.emit('user_disconnected', {
        nickname: nickname,
        userCount: users.size,
        activeUsers: activeUsers
      });

      io.emit('update_users', { activeUsers });

      console.log(`${nickname} left. Total users: ${users.size}`);
    }
  });

  /**
   * Handle socket errors
   */
  socket.on('error', (error) => {
    console.error(`Socket error for ${socket.id}:`, error);
  });
});

// ========================================
// SERVER STARTUP
// ========================================

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`\n================================================`);
  console.log(`🚀 Real-time Chat Server Started`);
  console.log(`================================================`);
  console.log(`Server running at: http://localhost:${PORT}`);
  console.log(`Socket.io listening on port ${PORT}`);
  console.log(`🤖 epstein AI enabled with Groq API`);
  console.log(`================================================\n`);
});

/**
 * Graceful shutdown
 */
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});
