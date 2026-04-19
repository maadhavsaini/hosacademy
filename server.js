require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const { Groq } = require('groq-sdk');
const jwt = require('jsonwebtoken');
const db = require('./database');
const User = require('./models/User');
const PREP_MESSAGE = require('./prep-message');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// JWT Secret (should be in .env in production)
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Initialize Groq client
let groq;
try {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY environment variable is not set');
  }
  groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
  });
  console.log('✅ Groq API client initialized successfully');
} catch (error) {
  console.error('❌ Failed to initialize Groq client:', error.message);
  process.exit(1);
}

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
    console.log(`📤 Calling Groq API with query: "${query}"`);
    
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      max_tokens: 256,
      messages: [
        {
          role: 'system',
          content: PREP_MESSAGE
        },
        {
          role: 'user',
          content: query
        }
      ]
    });

    const reply = response.choices[0].message.content;
    console.log(`📥 Groq API response received: "${reply}"`);
    return reply;
  } catch (error) {
    console.error('❌ Groq API error:', error.message);
    console.error('Error details:', error);
    return 'My brain hurts, try again later. 🤖';
  }
}

// ========================================
// AUTHENTICATION ENDPOINTS
// ========================================

/**
 * Sign up new user
 */
app.post('/api/auth/signup', (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Validate input
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password required' });
    }

    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ error: 'Username must be 3-20 characters' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Create user
    const user = User.create(username, email, password);

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log(`✅ New user signed up: ${username}`);
    res.json({ 
      success: true, 
      token, 
      user: { 
        id: user.id, 
        username: user.username, 
        email: user.email 
      } 
    });
  } catch (error) {
    console.error('❌ Signup error:', error.message);
    res.status(400).json({ error: error.message });
  }
});

/**
 * Log in user
 */
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Authenticate user
    const user = User.authenticate(username, password);

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    console.log(`✅ User logged in: ${username}`);
    res.json({ 
      success: true, 
      token, 
      user: { 
        id: user.id, 
        username: user.username, 
        email: user.email,
        avatar_url: user.avatar_url
      } 
    });
  } catch (error) {
    console.error('❌ Login error:', error.message);
    res.status(401).json({ error: error.message });
  }
});

/**
 * Validate token
 */
app.get('/api/auth/validate', (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, user: decoded });
  } catch (error) {
    res.status(401).json({ valid: false, error: 'Invalid token' });
  }
});

/**
 * Middleware to verify JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// ========================================
// SOCKET.IO CONNECTION HANDLING
// ========================================

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  /**
   * Handle user authentication with JWT
   */
  socket.on('auth', (data) => {
    const { token } = data;
    if (!token) {
      socket.emit('error', { message: 'Authentication required' });
      return;
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      socket.emit('error', { message: 'Invalid or expired token' });
      return;
    }

    // Store authenticated user
    users.set(socket.id, {
      socketId: socket.id,
      userId: decoded.userId,
      username: decoded.username,
      joinedAt: new Date(),
      isTyping: false
    });

    const activeUsers = Array.from(users.values()).map(u => u.username);

    io.emit('user_connected', {
      username: decoded.username,
      userCount: users.size,
      activeUsers: activeUsers
    });

    console.log(`${decoded.username} authenticated. Total users: ${users.size}`);

    socket.emit('auth_success', { username: decoded.username });
    socket.emit('update_users', { activeUsers });
    socket.broadcast.emit('update_users', { activeUsers });
  });

  /**
   * Handle legacy join with nickname (for backward compatibility)
   * Will be removed once all clients use JWT auth
   */
  socket.on('join', (nickname) => {
    // If user already authenticated via token, skip
    if (users.has(socket.id)) {
      return;
    }

    const validatedNickname = validateNickname(nickname);
    if (!validatedNickname) {
      socket.emit('error', { message: 'Invalid nickname' });
      return;
    }

    users.set(socket.id, {
      socketId: socket.id,
      userId: null,
      username: validatedNickname,
      joinedAt: new Date(),
      isTyping: false
    });

    const activeUsers = Array.from(users.values()).map(u => u.username);

    io.emit('user_connected', {
      username: validatedNickname,
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
      nickname: user.username,
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
      io.emit('user_stop_typing', { nickname: user.username });
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
      socket.broadcast.emit('user_typing', { nickname: user.username });
    }
  });

  /**
   * Handle stop typing
   */
  socket.on('user_stop_typing', () => {
    const user = users.get(socket.id);
    if (user) {
      user.isTyping = false;
      socket.broadcast.emit('user_stop_typing', { nickname: user.username });
    }
  });

  /**
   * Handle user disconnection
   */
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      const nickname = user.username;
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
