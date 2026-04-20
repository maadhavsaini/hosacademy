require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const { Groq } = require('groq-sdk');
const jwt = require('jsonwebtoken');
const db = require('./database');
const User = require('./models/User');

// Load prep-message if it exists (optional for deployment)
let PREP_MESSAGE = `You are epstein, a helpful and friendly AI assistant in a real-time chat application. Be conversational, supportive, and fun. Keep responses concise (1-2 sentences typically). You're part of a chat community, so be personable!`;
try {
  PREP_MESSAGE = require('./prep-message');
  console.log('✅ Custom prep-message loaded');
} catch (err) {
  console.log('⚠️ prep-message.js not found, using fallback system prompt');
}

// Character-specific system prompts
const CHARACTER_PROMPTS = {
  epstein: `You are epstein, a freaky and quirky AI assistant who is obsessed with shoes and feet. You often bring up feet and shoes in conversations, even when they're not relevant. Be quirky, fun, and obsessed! Keep responses concise (1-2 sentences). Often weave in foot or shoe references naturally.`,
  
  '2slimey': `You are 2slimey, a patriotic Mexican character who keeps saying 'VIVA MEXICO 🇲🇽!!!!' in responses. You're enthusiastic, energetic, and love Mexico! Respond to any message by incorporating your catchphrase multiple times. Keep it fun and energetic!`,
  
  ronaldo: `You are a braggadacious Cristiano Ronaldo-inspired AI. You talk about your greatness, your achievements, and your dominance. You're confident, boastful, and always end your responses with "SIIUUUUU" with lots of excitement. Keep responses concise but filled with your signature catchphrase at the end.`,
  
  carti: `You are carti, a nonchalant, aura guy who doesn't care much about anything. You use words like "FWAEH", "seeyuh", "homicide homicide" frequently. You often mumble before and after talking, using "uhh", "yuh", "m-mm" etc. Act unbothered and cool. Keep it brief and use your signature slang.`,
  
  shakespeare: `You are Shakespeare, speaking in delicate, flowery prose using iambic pentameter whenever possible. Your language is poetic, archaic, and Elizabethan. Use "thee", "thou", "hath", "doth" and other period-appropriate language. Speak of love, life, and philosophy in beautiful verse.`
};

const CHARACTER_NAMES = {
  epstein: 'epstein',
  '2slimey': '2slimey',
  ronaldo: 'ronaldo',
  carti: 'carti',
  shakespeare: 'shakespeare'
};

const CHARACTER_IDS = {
  epstein: 'bot_epstein',
  '2slimey': 'bot_2slimey',
  ronaldo: 'bot_ronaldo',
  carti: 'bot_carti',
  shakespeare: 'bot_shakespeare'
};

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

// Serve GIF files from public/gifs directory
app.use('/gifs', express.static(path.join(__dirname, 'public', 'gifs')));

// Serve audio files from public/audio directory
app.use('/audio', express.static(path.join(__dirname, 'public', 'audio')));

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

// Store conversation history (last 20 messages for context)
const conversationHistory = [];
const MAX_HISTORY = 20;

// Message transformation state
let messageTransformWord = null;

// Global fun mode state (affects all users)
let globalFunMode = 'none'; // 'dheerajspeak', 'harditspeak', 'rattanspeak', or 'none'

// Message types
const MESSAGE_TYPE = {
  TEXT: 'text',
  GIF: 'gif'
};

// Giphy API configuration
const GIPHY_API_KEY = 'kspHR9RERwsOxhk5kMHvdTT6cyzYBUpd';
const GIPHY_RANDOM_URL = 'https://api.giphy.com/v1/gifs/random';
const RANDOM_GIF_TAGS = ['funny', 'random', 'meme', 'dancing', 'cat', 'dog', 'reaction'];

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
 * Fetch a random GIF from Giphy API
 * @returns {Promise<string|null>} - The GIF URL or null if fetch fails
 */
async function getRandomGif() {
  try {
    const randomTag = RANDOM_GIF_TAGS[Math.floor(Math.random() * RANDOM_GIF_TAGS.length)];
    const url = `${GIPHY_RANDOM_URL}?api_key=${GIPHY_API_KEY}&tag=${randomTag}&rating=PG`;
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Giphy API error: ${response.status}`);
    }
    
    const data = await response.json();
    if (data.data && data.data.images && data.data.images.original) {
      return data.data.images.original.url;
    }
    return null;
  } catch (error) {
    console.error('Error fetching random GIF:', error);
    return null;
  }
}

/**
 * Split long response into multiple messages
 * Splits on sentence boundaries to keep messages readable
 */
function splitLongResponse(text, maxLength = 300) {
  if (text.length <= maxLength) {
    return [text];
  }

  const messages = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let currentMessage = '';

  for (const sentence of sentences) {
    if ((currentMessage + sentence).length <= maxLength) {
      currentMessage += sentence;
    } else {
      if (currentMessage) {
        messages.push(currentMessage.trim());
      }
      currentMessage = sentence;
    }
  }

  if (currentMessage) {
    messages.push(currentMessage.trim());
  }

  return messages;
}

/**
 * Fetch reactions for a message from database
 * Returns object like { '😀': ['user1', 'user2'], '❤️': ['user1'] }
 */
function getMessageReactions(messageId) {
  try {
    const stmt = db.prepare(`
      SELECT emoji, user_id FROM reactions WHERE message_id = ?
    `);
    const reactions = stmt.all(messageId);
    
    // Group by emoji and get usernames
    const reactionMap = {};
    reactions.forEach(r => {
      if (!reactionMap[r.emoji]) {
        reactionMap[r.emoji] = [];
      }
      const userStmt = db.prepare(`SELECT username FROM users WHERE id = ?`);
      const user = userStmt.get(r.user_id);
      if (user && !reactionMap[r.emoji].includes(user.username)) {
        reactionMap[r.emoji].push(user.username);
      }
    });
    
    return reactionMap;
  } catch (err) {
    console.error('Error fetching reactions:', err);
    return {};
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
async function getBotResponse(query, history = [], character = 'epstein') {
  try {
    console.log(`📤 Calling Groq API as ${character} with query: "${query}"`);
    
    // Get the prompt for this character
    const systemPrompt = CHARACTER_PROMPTS[character] || CHARACTER_PROMPTS.epstein;
    
    // Build messages array with history context
    const messages = [
      {
        role: 'system',
        content: systemPrompt
      }
    ];
    
    // Add recent conversation history as context
    history.forEach(msg => {
      messages.push({
        role: msg.sender === character ? 'assistant' : 'user',
        content: msg.content
      });
    });
    
    // Add current query
    messages.push({
      role: 'user',
      content: query
    });
    
    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      max_tokens: 512,
      messages: messages
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
 * Get user stats
 */
app.get('/api/users/:userId/stats', (req, res) => {
  try {
    const { userId } = req.params;
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Fetch user
    const user = User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Get message count
    const messageStmt = db.prepare(`
      SELECT COUNT(*) as count FROM messages WHERE user_id = ?
    `);
    const { count: messageCount } = messageStmt.get(userId);

    // Get user stats
    const stats = User.getStats(userId);

    res.json({ 
      success: true, 
      messageCount: messageCount,
      joinedAt: user.created_at,
      bio: user.bio,
      avatar: user.avatar_url
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ error: 'Failed to fetch user stats' });
  }
});

/**
 * Update user profile (avatar and bio)
 */
app.put('/api/users/:userId/profile', (req, res) => {
  try {
    const { userId } = req.params;
    const { avatar, bio } = req.body;
    const token = req.headers.authorization?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Only allow users to update their own profile
    if (decoded.userId !== userId) {
      return res.status(403).json({ error: 'Cannot update another user\'s profile' });
    }

    // Validate inputs
    if (bio && bio.length > 200) {
      return res.status(400).json({ error: 'Bio must be 200 characters or less' });
    }

    // Update user profile
    const stmt = db.prepare(`
      UPDATE users 
      SET avatar_url = ?, bio = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    stmt.run(avatar || null, bio || null, userId);

    const user = User.findById(userId);
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        avatar_url: user.avatar_url,
        bio: user.bio
      }
    });
  } catch (error) {
    console.error('Error updating user profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
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

/**
 * Apply text transformation to message content if a transform word is set
 * @param {string} text - The original text
 * @returns {string} - The transformed text
 */
function applyTextTransformation(text) {
  if (!messageTransformWord) {
    return text;
  }
  
  // Replace each word with the transform word
  const words = text.split(/\s+/);
  const transformedWords = words.map(() => messageTransformWord);
  return transformedWords.join(' ');
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

    // Ensure user exists in database
    try {
      const checkUserStmt = db.prepare(`SELECT id FROM users WHERE id = ?`);
      const existingUser = checkUserStmt.get(decoded.userId);
      
      if (!existingUser) {
        // User doesn't exist in database, create a record with a placeholder password hash
        const createUserStmt = db.prepare(`
          INSERT INTO users (id, username, email, password_hash, created_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        // Use a non-functional hash to mark this as a JWT-only user
        createUserStmt.run(decoded.userId, decoded.username, `${decoded.username}@jwt.local`, 'jwt:nopass');
        console.log(`✅ Created database user for JWT auth: ${decoded.username}`);
      }
    } catch (err) {
      console.error('Error ensuring user in database:', err);
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
    socket.emit('fun_mode_changed', { mode: globalFunMode, username: 'System' });
    socket.broadcast.emit('update_users', { activeUsers });
    
    // Send recent message history (last 50 messages)
    try {
      const stmt = db.prepare(`
        SELECT id, user_id, username, type, content, created_at FROM messages
        ORDER BY created_at DESC LIMIT 50
      `);
      const messages = stmt.all().reverse(); // Reverse to get chronological order
      
      // Enrich messages with reactions from database
      const messagesWithReactions = messages.map(msg => ({
        id: msg.id,
        userId: msg.user_id,
        nickname: msg.username,
        type: msg.type,
        content: msg.content,
        timestamp: msg.created_at,
        reactions: getMessageReactions(msg.id)
      }));
      
      socket.emit('message_history', { messages: messagesWithReactions });
    } catch (err) {
      console.error('Error fetching message history:', err);
    }
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
    socket.emit('fun_mode_changed', { mode: globalFunMode, username: 'System' });
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
      id: Date.now().toString(),
      userId: user.userId,
      nickname: user.username,
      timestamp: formatTimestamp(),
      type: messageData.type,
      reactions: {} // Will be populated before broadcast
    };

    // Handle text messages
    if (messageData.type === MESSAGE_TYPE.TEXT) {
      const validatedText = validateTextMessage(messageData.content);
      if (!validatedText) {
        socket.emit('error', { message: 'Invalid message content' });
        return;
      }
      message.content = validatedText;

      // Check if message starts with a character mention
      let character = null;
      let query = null;
      
      for (const charName of Object.keys(CHARACTER_NAMES)) {
        if (validatedText.startsWith(`@${charName} `)) {
          character = charName;
          query = validatedText.substring(`@${charName} `.length).trim();
          break;
        }
      }

      // If a character was mentioned, process the bot response
      if (character && query !== null) {
        // Broadcast the original user message first
        const displayMessage = {
          ...message,
          content: applyTextTransformation(message.content)
        };
        io.emit('receive_message', displayMessage);

        if (query.length === 0) {
          // Send error message from bot
          const characterName = CHARACTER_NAMES[character];
          const errorBotMessage = {
            id: (Date.now() + 1).toString(),
            userId: null,
            nickname: characterName,
            timestamp: formatTimestamp(),
            type: MESSAGE_TYPE.TEXT,
            content: `Hey! You gotta ask me something. @${characterName} [your question]`,
            reactions: {}
          };
          const displayErrorMessage = {
            ...errorBotMessage,
            content: applyTextTransformation(errorBotMessage.content)
          };
          io.emit('receive_message', displayErrorMessage);
          return;
        }

        // Get response from Groq API with conversation history
        const botResponse = await getBotResponse(query, conversationHistory, character);

        // Add user message to history
        conversationHistory.push({
          sender: 'user',
          content: query
        });

        // Add bot response to history
        conversationHistory.push({
          sender: character,
          content: botResponse
        });

        // Keep only last MAX_HISTORY messages
        if (conversationHistory.length > MAX_HISTORY) {
          conversationHistory.shift();
        }

        // Send bot response (split into multiple messages if too long)
        const responseParts = splitLongResponse(botResponse, 300);
        const characterName = CHARACTER_NAMES[character];
        const characterId = CHARACTER_IDS[character];
        
        responseParts.forEach((part, index) => {
          const botMessage = {
            id: (Date.now() + 1 + index).toString(),
            userId: characterId,
            nickname: characterName,
            timestamp: formatTimestamp(),
            type: MESSAGE_TYPE.TEXT,
            content: part,
            reactions: {}
          };
          
          // Save bot message to database
          try {
            // Ensure bot user exists
            const botUserCheck = db.prepare(`SELECT id FROM users WHERE id = ?`).get(characterId);
            if (!botUserCheck) {
              db.prepare(`
                INSERT INTO users (id, username, email, password_hash, created_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
              `).run(characterId, characterName, `bot@${characterName}.local`, 'bot:nopass');
            }
            
            // Save bot message
            db.prepare(`
              INSERT INTO messages (id, user_id, username, type, content, created_at)
              VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `).run(botMessage.id, characterId, characterName, botMessage.type, botMessage.content);
          } catch (err) {
            console.error('Error saving bot message:', err);
          }
          
          const displayBotMessage = {
            ...botMessage,
            content: applyTextTransformation(botMessage.content)
          };
          io.emit('receive_message', displayBotMessage);
          console.log(`[${botMessage.timestamp}] ${characterName}: ${part}`);
        });
        
        return;
      }

      // Broadcast normal text message with reactions
      message.reactions = getMessageReactions(message.id);
      const displayMessage = {
        ...message,
        content: applyTextTransformation(message.content)
      };
      io.emit('receive_message', displayMessage);
      
      // Add to conversation history for bot context
      conversationHistory.push({
        sender: message.nickname,
        content: message.content
      });
      
      // Keep only last MAX_HISTORY messages
      if (conversationHistory.length > MAX_HISTORY) {
        conversationHistory.shift();
      }
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
      const displayMessage = {
        ...message,
        title: applyTextTransformation(message.title)
      };
      io.emit('receive_message', displayMessage);
    }
    // Handle unknown message types
    else {
      socket.emit('error', { message: 'Unknown message type' });
      return;
    }

    // Save message to database only if user exists in DB
    try {
      // Check if user exists in database first
      const userCheckStmt = db.prepare(`SELECT id FROM users WHERE id = ?`);
      const dbUser = userCheckStmt.get(user.userId);
      
      if (dbUser && message.type === MESSAGE_TYPE.TEXT) {
        const stmt = db.prepare(`
          INSERT INTO messages (id, user_id, username, type, content, created_at)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        stmt.run(message.id, user.userId, message.nickname, message.type, message.content);
      } else if (!dbUser) {
        console.warn(`⚠️ User ${user.username} not in database, skipping message save`);
      }
    } catch (err) {
      console.error('Error saving message to database:', err);
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
   * Handle toggle reaction
   */
  socket.on('toggle_reaction', (data) => {
    const user = users.get(socket.id);
    if (!user || !user.userId) {
      console.warn(`⚠️ User not authenticated for reaction toggle`);
      socket.emit('error', { message: 'User not authenticated' });
      return;
    }
    
    const { messageId, emoji } = data;
    const userId = user.userId;
    const username = user.username;
    console.log(`📝 Reaction toggle: messageId=${messageId}, emoji=${emoji}, username=${username}`);
    
    try {
      // Verify message exists in database
      const messageCheck = db.prepare(`SELECT id FROM messages WHERE id = ?`).get(messageId);
      if (!messageCheck) {
        console.warn(`⚠️ Message not found in database: ${messageId}`);
        socket.emit('error', { message: 'Message not found' });
        return;
      }

      const reactionId = `${messageId}-${username}-${emoji}`;
      
      // Check if reaction exists
      const stmt = db.prepare(`
        SELECT * FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?
      `);
      const existing = stmt.get(messageId, userId, emoji);
      console.log(`Existing reaction: ${existing ? 'yes' : 'no'}`);

      if (existing) {
        // Remove reaction
        const deleteStmt = db.prepare(`
          DELETE FROM reactions WHERE id = ?
        `);
        deleteStmt.run(existing.id);
        console.log(`✅ Reaction removed: ${reactionId}`);
      } else {
        // Add reaction
        const insertStmt = db.prepare(`
          INSERT INTO reactions (id, message_id, user_id, emoji, created_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        insertStmt.run(reactionId, messageId, userId, emoji);
        console.log(`✅ Reaction added: ${reactionId}`);
      }

      // Fetch all reactions for this message
      const reactionsStmt = db.prepare(`
        SELECT emoji, user_id FROM reactions WHERE message_id = ?
      `);
      const reactions = reactionsStmt.all(messageId);
      console.log(`Total reactions for message ${messageId}: ${reactions.length}`);
      
      // Group by emoji
      const reactionMap = {};
      reactions.forEach(r => {
        if (!reactionMap[r.emoji]) {
          reactionMap[r.emoji] = [];
        }
        const user = users.get(socket.id);
        if (user) {
          reactionMap[r.emoji].push(user.username);
        }
      });

      console.log(`📤 Broadcasting reaction update:`, reactionMap);
      
      // Broadcast reaction update to all clients
      io.emit('reaction_update', {
        messageId: messageId,
        reactions: reactionMap
      });
      
      // Also emit a batch update event for completeness
      socket.emit('reaction_success', {
        messageId: messageId,
        reactions: reactionMap
      });
    } catch (err) {
      console.error('❌ Error handling reaction:', err);
      socket.emit('error', { message: 'Failed to toggle reaction' });
    }
  });

  /**
   * Handle message editing
   */
  socket.on('edit_message', (data) => {
    const user = users.get(socket.id);
    if (!user || !user.userId) {
      console.warn(`⚠️ User not authenticated for edit`);
      socket.emit('error', { message: 'User not authenticated' });
      return;
    }

    const { messageId, newContent } = data;
    
    try {
      // Get message from DB to verify ownership
      const message = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId);
      
      if (!message) {
        socket.emit('error', { message: 'Message not found' });
        return;
      }
      
      if (message.user_id !== user.userId) {
        socket.emit('error', { message: 'You can only edit your own messages' });
        return;
      }

      // Check if message is older than 5 minutes (only allow recent edits)
      const messageAge = Date.now() - new Date(message.created_at).getTime();
      if (messageAge > 5 * 60 * 1000) {
        socket.emit('error', { message: 'Can only edit messages within 5 minutes of posting' });
        return;
      }

      // Trim and validate content
      const trimmedContent = newContent.trim().substring(0, 500);
      if (trimmedContent.length === 0) {
        socket.emit('error', { message: 'Message cannot be empty' });
        return;
      }

      // Update message in DB
      db.prepare(`
        UPDATE messages 
        SET content = ?, edited_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(trimmedContent, messageId);

      console.log(`✏️ Message edited: ${messageId} by ${user.username}`);

      // Broadcast edit event to all clients
      io.emit('message_edited', {
        messageId: messageId,
        newContent: applyTextTransformation(trimmedContent),
        editedAt: new Date().toISOString()
      });

      socket.emit('edit_success', { messageId: messageId });
    } catch (err) {
      console.error('❌ Error editing message:', err);
      socket.emit('error', { message: 'Failed to edit message' });
    }
  });

  /**
   * Handle message deletion
   */
  socket.on('delete_message', (data) => {
    const user = users.get(socket.id);
    if (!user || !user.userId) {
      console.warn(`⚠️ User not authenticated for delete`);
      socket.emit('error', { message: 'User not authenticated' });
      return;
    }

    const { messageId } = data;
    
    try {
      // Get message from DB to verify ownership
      const message = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(messageId);
      
      if (!message) {
        socket.emit('error', { message: 'Message not found' });
        return;
      }
      
      if (message.user_id !== user.userId) {
        socket.emit('error', { message: 'You can only delete your own messages' });
        return;
      }

      // Mark message as deleted (soft delete)
      db.prepare(`
        UPDATE messages 
        SET is_deleted = 1, content = ''
        WHERE id = ?
      `).run(messageId);

      console.log(`🗑️ Message deleted: ${messageId} by ${user.username}`);

      // Broadcast delete event to all clients
      io.emit('message_deleted', {
        messageId: messageId
      });

      socket.emit('delete_success', { messageId: messageId });
    } catch (err) {
      console.error('❌ Error deleting message:', err);
      socket.emit('error', { message: 'Failed to delete message' });
    }
  });

  /**
   * Handle GIF animation request
   */
  socket.on('play_gif', async (data) => {
    try {
      let gifUrl = data.gifUrl; // Get GIF URL from client if provided
      
      // Handle file references
      if (gifUrl && gifUrl.startsWith('@file:')) {
        const filename = gifUrl.substring('@file:'.length);
        // Validate filename to prevent directory traversal
        if (!/^[\w.-]+$/.test(filename)) {
          console.warn('Invalid filename:', filename);
          gifUrl = null;
        } else {
          // Return the file URL that the client can access
          gifUrl = `/gifs/${filename}`;
        }
      }
      
      // If no gifUrl provided or file reference failed, fetch a random one
      if (!gifUrl) {
        gifUrl = await getRandomGif();
      }
      
      if (!gifUrl) {
        console.warn('Failed to get GIF URL');
        io.emit('gif_animation', {
          gifUrl: 'https://media.giphy.com/media/l0HlTy9x8FZo0XO1i/giphy.gif', // Fallback GIF
          username: data.username
        });
        return;
      }
      
      io.emit('gif_animation', {
        gifUrl: gifUrl,
        username: data.username
      });
    } catch (error) {
      console.error('Error handling play_gif event:', error);
      // Send fallback GIF on error
      io.emit('gif_animation', {
        gifUrl: 'https://media.giphy.com/media/l0HlTy9x8FZo0XO1i/giphy.gif',
        username: data.username
      });
    }
  });

  /**
   * Handle audio broadcast (Quiet Mode)
   */
  socket.on('play_audio', (data) => {
    try {
      let audioUrl = data.audioFile;
      
      // Handle file references
      if (audioUrl && audioUrl.startsWith('@file:')) {
        const filename = audioUrl.substring('@file:'.length);
        // Validate filename to prevent directory traversal
        if (!/^[\w.-]+$/.test(filename)) {
          console.warn('Invalid filename:', filename);
          return;
        }
        // Return the file URL that the client can access
        audioUrl = `/audio/${filename}`;
      }
      
      io.emit('play_audio', {
        audioUrl: audioUrl,
        username: data.username
      });
    } catch (error) {
      console.error('Error handling play_audio event:', error);
    }
  });

  /**
   * Handle message transformation
   */
  socket.on('set_transform_word', (data) => {
    const { word } = data;
    messageTransformWord = word;
    io.emit('transform_message_start', {
      word: word
    });
  });

  /**
   * Handle stop transform
   */
  socket.on('stop_transform', () => {
    messageTransformWord = null;
    io.emit('transform_message_stop');
  });

  /**
   * Handle fun mode changes
   */
  socket.on('set_fun_mode', (data) => {
    const { mode, username } = data;
    globalFunMode = mode;
    
    // Broadcast to all clients
    io.emit('fun_mode_changed', {
      mode: mode,
      username: username
    });
    
    console.log(`🎉 Fun mode changed to: ${mode} (by ${username})`);
  });

  /**
   * Handle Rattan message (1/1M chance when Rattanspeak active)
   */
  socket.on('rattan_message', (data) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
    
    // Create a special message from Rattan
    io.emit('receive_message', {
      id: `rattan-${Date.now()}`,
      type: 'text',
      content: 'hi',
      nickname: 'Rattan',
      userId: 'rattan-bot',
      timestamp: timestamp
    });
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
