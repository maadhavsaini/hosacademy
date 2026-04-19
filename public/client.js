// ========================================
// SOCKET.IO CONNECTION SETUP
// ========================================

const socket = io();

// ========================================
// CONSTANTS & CONFIGURATION
// ========================================

const GIPHY_API_KEY = 'kspHR9RERwsOxhk5kMHvdTT6cyzYBUpd';
const GIPHY_SEARCH_URL = 'https://api.giphy.com/v1/gifs/search';
const MAX_MESSAGE_LENGTH = 500;

// Message types enum
const MESSAGE_TYPE = {
  TEXT: 'text',
  GIF: 'gif'
};

// ========================================
// STATE VARIABLES
// ========================================

let currentNickname = '';
let isConnected = false;
let isAtBottom = true;
let typingUsers = new Set();
let typingTimeout = null;
let isCurrentlyTyping = false;
let gifSearchTimeout = null;

// ========================================
// DOM ELEMENTS
// ========================================

// Login Screen Elements
const loginScreen = document.getElementById('loginScreen');
const loginForm = document.getElementById('loginForm');
const nicknameInput = document.getElementById('nicknameInput');

// Chat App Elements
const chatApp = document.getElementById('chatApp');
const messagesContainer = document.getElementById('messagesContainer');
const messageForm = document.getElementById('messageForm');
const messageInput = document.getElementById('messageInput');
const usersList = document.getElementById('usersList');
const currentNicknameDisplay = document.getElementById('currentNickname');
const userCountDisplay = document.getElementById('userCount');
const onlineCountDisplay = document.getElementById('onlineCount');
const typingIndicator = document.getElementById('typingIndicator');
const hamburgerBtn = document.getElementById('hamburgerBtn');
const sidebar = document.getElementById('sidebar');

// GIF Modal Elements
const gifBtn = document.getElementById('gifBtn');
const gifModal = document.getElementById('gifModal');
const gifModalClose = document.getElementById('gifModalClose');
const gifSearchInput = document.getElementById('gifSearchInput');
const gifResults = document.getElementById('gifResults');

// Brainrot Mode Elements
const brainrotToggle = document.getElementById('brainrotToggle');

// ========================================
// BRAINROT SLANG DICTIONARY
// ========================================

const slangDictionary = {
  'good': 'tuffblud',
  'bad': 'chudtastic',
  'brother': 'blud',
  'yes': 'hell yeah',
  'no': 'nah',
  'hello': 'yo chat',
  'hi': 'yo',
  'crazy': 'tuff',
  'wtf': 'erm, what the tung tung?!',
  'cool': 'based',
  'friend': 'homie',
  'why': 'ayo why tho',
  'what': 'wha',
  'okay': 'ight',
  'thanks': 'thanks g',
  'sorry': 'my bad blud'
};

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Translate text to Brainrot slang if Brainrot Mode is enabled
 */
function translateToBrainrot(text) {
  if (!brainrotToggle.checked) {
    return text;
  }

  let translatedText = text;

  // Replace whole words only (case-insensitive)
  Object.entries(slangDictionary).forEach(([original, slang]) => {
    // Create regex with word boundaries, case-insensitive
    const regex = new RegExp(`\\b${original}\\b`, 'gi');
    translatedText = translatedText.replace(regex, (match) => {
      // Preserve case: if original word was capitalized, capitalize the slang
      if (match[0] === match[0].toUpperCase()) {
        return slang.charAt(0).toUpperCase() + slang.slice(1);
      }
      return slang;
    });
  });

  return translatedText;
}

/**
 * Escape HTML to prevent XSS
 * @param {String} text - Text to escape
 * @returns {String} - Escaped HTML
 */
function escapeHTML(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Check if user is scrolled to bottom
 * @returns {Boolean}
 */
function isScrolledToBottom() {
  const threshold = 50; // pixels
  return (
    messagesContainer.scrollHeight - messagesContainer.scrollTop - messagesContainer.clientHeight < threshold
  );
}

/**
 * Scroll to bottom of chat
 */
function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

/**
 * Format timestamp
 * @param {Date} date - Date object
 * @returns {String} - Formatted time string
 */
function formatTime(date) {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

/**
 * Remove the welcome message if it exists
 */
function removeWelcomeMessageIfNeeded() {
  const welcomeMessage = messagesContainer.querySelector('.welcome-message');
  if (welcomeMessage) {
    welcomeMessage.remove();
  }
}

// ========================================
// GIF MODAL FUNCTIONALITY
// ========================================

/**
 * Open the GIF search modal
 */
function openGifModal() {
  gifModal.classList.add('open');
  gifSearchInput.focus();
}

/**
 * Close the GIF search modal
 */
function closeGifModal() {
  gifModal.classList.remove('open');
  gifSearchInput.value = '';
  gifResults.innerHTML = '<p class="gif-loading-text">Search for GIFs to get started</p>';
  messageInput.focus();
}

/**
 * Search for GIFs using Giphy API
 */
async function searchGifs(query) {
  if (!query.trim()) {
    gifResults.innerHTML = '<p class="gif-loading-text">Search for GIFs to get started</p>';
    return;
  }

  gifResults.innerHTML = '<p class="gif-loading-text">Loading...</p>';

  try {
    const url = `${GIPHY_SEARCH_URL}?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=20&rating=PG`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.data.length === 0) {
      gifResults.innerHTML = '<p class="gif-loading-text">No GIFs found. Try another search!</p>';
      return;
    }

    displayGifResults(data.data);
  } catch (error) {
    console.error('GIF search error:', error);
    gifResults.innerHTML = '<p class="gif-error-text">Error searching GIFs. Please try again.</p>';
  }
}

/**
 * Display GIF search results in a grid
 */
function displayGifResults(gifs) {
  gifResults.innerHTML = '';

  gifs.forEach((gif) => {
    const gifItem = document.createElement('div');
    gifItem.className = 'gif-item';

    const img = document.createElement('img');
    img.src = gif.images.fixed_height_small.url;
    img.alt = gif.title || 'GIF';
    img.loading = 'lazy';

    gifItem.appendChild(img);

    // Handle GIF selection
    gifItem.addEventListener('click', () => {
      selectGif(gif.images.original.url, gif.title);
    });

    gifResults.appendChild(gifItem);
  });
}

/**
 * Select a GIF and send it to the server
 */
function selectGif(gifUrl, gifTitle) {
  if (!gifUrl || !gifUrl.startsWith('http')) {
    console.error('Invalid GIF URL');
    return;
  }

  // Create message object with type 'gif'
  const message = {
    type: MESSAGE_TYPE.GIF,
    content: gifUrl,
    title: gifTitle || 'GIF'
  };

  socket.emit('send_message', message);
  closeGifModal();
}

// ========================================
// GIF MODAL EVENT LISTENERS
// ========================================

gifBtn.addEventListener('click', (e) => {
  e.preventDefault();
  openGifModal();
});

gifModalClose.addEventListener('click', closeGifModal);

gifModal.addEventListener('click', (e) => {
  if (e.target === gifModal) {
    closeGifModal();
  }
});

// GIF Search with debouncing
gifSearchInput.addEventListener('input', () => {
  clearTimeout(gifSearchTimeout);
  gifSearchTimeout = setTimeout(() => {
    searchGifs(gifSearchInput.value);
  }, 300);
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && gifModal.classList.contains('open')) {
    closeGifModal();
  }
});



// ========================================
// LOGIN SCREEN FUNCTIONALITY
// ========================================

/**
 * Handle login form submission
 */
loginForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const nickname = nicknameInput.value.trim();

  // Validation
  if (!nickname) {
    alert('Please enter a nickname');
    return;
  }

  if (nickname.length < 2) {
    alert('Nickname must be at least 2 characters');
    return;
  }

  if (nickname.length > 20) {
    alert('Nickname must not exceed 20 characters');
    return;
  }

  // Prevent special characters
  if (!/^[a-zA-Z0-9\s_-]+$/.test(nickname)) {
    alert('Nickname can only contain letters, numbers, spaces, underscores, and hyphens');
    return;
  }

  // Store nickname and join
  currentNickname = nickname;
  socket.emit('join', nickname);

  // Update UI
  showChatApp();
});

/**
 * Handle Enter key on nickname input
 */
nicknameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    loginForm.dispatchEvent(new Event('submit'));
  }
});

/**
 * Show the chat application and hide login screen
 */
function showChatApp() {
  loginScreen.classList.add('hidden');
  chatApp.classList.remove('hidden');
  currentNicknameDisplay.textContent = currentNickname;
  messageInput.focus();
}

// ========================================
// MESSAGE SENDING FUNCTIONALITY
// ========================================

/**
 * Handle message form submission
 */
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();

  const message = messageInput.value.trim();

  // Validation - prevent empty messages
  if (!message) {
    messageInput.focus();
    return;
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    alert(`Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`);
    return;
  }

  // Apply Brainrot translation if enabled
  const translatedMessage = translateToBrainrot(message);

  // Create message object with type 'text'
  const messageData = {
    type: MESSAGE_TYPE.TEXT,
    content: translatedMessage
  };

  // Emit message to server
  socket.emit('send_message', messageData);

  // Clear input
  messageInput.value = '';
  messageInput.focus();
  
  // Reset typing indicator
  isCurrentlyTyping = false;
  clearTimeout(typingTimeout);
  socket.emit('user_stop_typing');
  
  // Update send button state
  updateSendButtonState();
});

/**
 * Handle input changes for send button state and typing indicator
 */
messageInput.addEventListener('input', () => {
  handleUserTyping();
  updateSendButtonState();
});

/**
 * Update send button disabled state
 */
function updateSendButtonState() {
  const sendBtn = document.querySelector('.send-btn');
  const hasText = messageInput.value.trim().length > 0;
  sendBtn.disabled = !hasText;
}

/**
 * Handle typing user event
 */
function handleUserTyping() {
  if (!isCurrentlyTyping && messageInput.value.trim()) {
    isCurrentlyTyping = true;
    socket.emit('user_typing');
  }

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    isCurrentlyTyping = false;
    socket.emit('user_stop_typing');
  }, 1500);
}

/**
 * Handle Enter and Shift+Enter keys
 */
messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    messageForm.dispatchEvent(new Event('submit'));
  }
});

// ========================================
// MESSAGE RENDERING
// ========================================

/**
 * Add a message to the chat
 * @param {Object} message - Message object { type, content, nickname, timestamp }
 * @param {Boolean} isOwn - Whether the message is from the current user
 */
function addMessage(message, isOwn = false) {
  const messageElement = document.createElement('div');
  messageElement.className = `message user-message ${isOwn ? 'own' : 'other'}`;

  const header = document.createElement('div');
  header.className = 'message-header';

  const nickname = document.createElement('span');
  nickname.className = 'nickname';
  nickname.textContent = message.nickname;

  const timestamp = document.createElement('span');
  timestamp.className = 'timestamp';
  timestamp.textContent = message.timestamp;

  header.appendChild(nickname);
  header.appendChild(timestamp);

  const content = document.createElement('div');
  content.className = 'message-content';

  // Render based on message type
  if (message.type === MESSAGE_TYPE.GIF && message.content) {
    content.classList.add('gif-content');
    const img = document.createElement('img');
    img.src = message.content;
    img.alt = message.title || 'GIF';
    img.loading = 'lazy';
    img.style.maxWidth = '100%';
    img.style.borderRadius = '8px';
    content.appendChild(img);
  } else if (message.type === MESSAGE_TYPE.TEXT) {
    // Sanitize text content
    content.textContent = message.content;
  }

  messageElement.appendChild(header);
  messageElement.appendChild(content);

  removeWelcomeMessageIfNeeded();
  messagesContainer.appendChild(messageElement);

  // Only auto-scroll if user is already at the bottom
  if (isAtBottom) {
    scrollToBottom();
  }
}

/**
 * Add a system notification to the chat
 * @param {String} text - The notification text
 */
function addSystemNotification(text) {
  const messageElement = document.createElement('div');
  messageElement.className = 'message system';

  const content = document.createElement('div');
  content.className = 'message-content';
  content.textContent = text;

  messageElement.appendChild(content);

  removeWelcomeMessageIfNeeded();
  messagesContainer.appendChild(messageElement);

  // Auto-scroll for system messages
  if (isAtBottom) {
    scrollToBottom();
  }
}

// ========================================
// SCROLL TRACKING
// ========================================

/**
 * Track if user is scrolled to bottom
 */
messagesContainer.addEventListener('scroll', () => {
  isAtBottom = isScrolledToBottom();
});

// ========================================
// ACTIVE USERS MANAGEMENT
// ========================================

/**
 * Update the active users list
 * @param {Array} activeUsers - Array of active user nicknames
 */
function updateUsersList(activeUsers) {
  usersList.innerHTML = '';

  if (activeUsers.length === 0) {
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'empty-users';
    emptyMessage.textContent = 'No users connected';
    usersList.appendChild(emptyMessage);
    return;
  }

  activeUsers.forEach((nickname) => {
    const userItem = document.createElement('div');
    userItem.className = 'user-item';
    userItem.textContent = nickname;
    usersList.appendChild(userItem);
  });

  // Update online count
  onlineCountDisplay.textContent = activeUsers.length;
}

// ========================================
// MOBILE MENU FUNCTIONALITY
// ========================================

/**
 * Toggle sidebar visibility on mobile
 */
hamburgerBtn.addEventListener('click', () => {
  sidebar.classList.toggle('open');
  hamburgerBtn.classList.toggle('active');
});

/**
 * Close sidebar when clicking outside
 */
document.addEventListener('click', (e) => {
  if (!e.target.closest('.sidebar') && !e.target.closest('.hamburger')) {
    sidebar.classList.remove('open');
    hamburgerBtn.classList.remove('active');
  }
});

// ========================================
// SOCKET.IO EVENT LISTENERS
// ========================================

/**
 * Handle receiving a message (text or gif)
 */
socket.on('receive_message', (message) => {
  const isOwn = message.nickname === currentNickname;
  addMessage(message, isOwn);
});

/**
 * Handle user typing
 */
socket.on('user_typing', (data) => {
  typingUsers.add(data.nickname);
  updateTypingIndicator();
});

/**
 * Handle user stop typing
 */
socket.on('user_stop_typing', (data) => {
  typingUsers.delete(data.nickname);
  updateTypingIndicator();
});

/**
 * Update typing indicator display
 */
function updateTypingIndicator() {
  if (typingUsers.size === 0) {
    typingIndicator.innerHTML = '';
    return;
  }

  const userArray = Array.from(typingUsers);
  let text = '';

  if (userArray.length === 1) {
    text = `<em>${escapeHTML(userArray[0])} is typing...</em>`;
  } else if (userArray.length === 2) {
    text = `<em>${escapeHTML(userArray[0])} and ${escapeHTML(userArray[1])} are typing...</em>`;
  } else {
    text = `<em>${escapeHTML(userArray[0])} and ${userArray.length - 1} others are typing...</em>`;
  }

  typingIndicator.innerHTML = text;
}



/**
 * Handle user connection notification
 */
socket.on('user_connected', (data) => {
  const notificationText = `✓ ${data.nickname} joined the chat`;
  addSystemNotification(notificationText);
  userCountDisplay.textContent = data.userCount;
});

/**
 * Handle user disconnection notification
 */
socket.on('user_disconnected', (data) => {
  const notificationText = `✗ ${data.nickname} left the chat`;
  addSystemNotification(notificationText);
  userCountDisplay.textContent = data.userCount;
  
  // Remove from typing users
  typingUsers.delete(data.nickname);
  updateTypingIndicator();
});

/**
 * Handle active users list update
 */
socket.on('update_users', (data) => {
  updateUsersList(data.activeUsers);
});

/**
 * Handle socket connection
 */
socket.on('connect', () => {
  console.log('Connected to server with ID:', socket.id);
  isConnected = true;
});

/**
 * Handle socket disconnection
 */
socket.on('disconnect', () => {
  console.log('Disconnected from server');
  isConnected = false;
  addSystemNotification('⚠ Connection lost. Please refresh the page.');
});

/**
 * Handle socket errors
 */
socket.on('error', (error) => {
  console.error('Socket error:', error);
  addSystemNotification('⚠ An error occurred. Please try again.');
});

// ========================================
// INITIALIZATION
// ========================================

/**
 * Initialize the application
 */
function init() {
  nicknameInput.focus();
  updateSendButtonState();
  console.log('Real-time Chat Application Initialized');
  console.log('Waiting for nickname input...');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
