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
const API_BASE = window.location.origin;

// Message types enum
const MESSAGE_TYPE = {
  TEXT: 'text',
  GIF: 'gif'
};

// ========================================
// STATE VARIABLES
// ========================================

let currentNickname = '';
let currentUserId = '';
let jwtToken = localStorage.getItem('jwtToken');
let isConnected = false;
let isAtBottom = true;
let typingUsers = new Set();
let typingTimeout = null;
let isCurrentlyTyping = false;
let gifSearchTimeout = null;
let searchTerm = '';
let allMessages = [];
let userProfiles = {};
let editingProfileUserId = null;
let currentProfileAvatar = '';
let searchCollapsed = false;
let messageTransformWords = [];
let messageTransformActive = false;
let userIdMap = {}; // Maps username to userId for profile lookups
const MESSAGE_GROUP_TIME = 5 * 60 * 1000; // 5 minutes in milliseconds

// Global fun mode state (affects all users)
let activeFunMode = 'none'; // 'dheerajspeak', 'harditspeak', 'rattanspeak', or 'none'

// ========================================
// DOM ELEMENTS
// ========================================

// Auth Screen Elements
const authScreen = document.getElementById('authScreen');
const loginForm = document.getElementById('loginForm');
const signupForm = document.getElementById('signupForm');
const authTabBtns = document.querySelectorAll('.auth-tab-btn');
const loginMessage = document.getElementById('loginMessage');
const signupMessage = document.getElementById('signupMessage');

// Legacy Login Screen Elements (for fallback)
const legacyLoginScreen = document.getElementById('loginScreen');
const legacyLoginForm = document.getElementById('legacyLoginForm');
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

// New UI Elements
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const profileModal = document.getElementById('profileModal');
const profileModalClose = document.getElementById('profileModalClose');
const searchToggleBtn = document.getElementById('searchToggleBtn');
const chatSearchBar = document.getElementById('chatSearchBar');
const editProfileBtn = document.getElementById('editProfileBtn');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const profileViewMode = document.getElementById('profileViewMode');
const profileEditMode = document.getElementById('profileEditMode');
const profileAvatarInput = document.getElementById('profileAvatarInput');
const profileBioEdit = document.getElementById('profileBioEdit');
const bioCharCount = document.getElementById('bioCharCount');

// Fun Button Elements
const funButton = document.getElementById('funButton');
const funModal = document.getElementById('funModal');
const funModalClose = document.getElementById('funModalClose');
const gifAnimationBtn = document.getElementById('gifAnimationBtn');
const messageTransformBtn = document.getElementById('messageTransformBtn');
const quietModeBtn = document.getElementById('quietModeBtn');
const dheerajspeakBtn = document.getElementById('dheerajspeakBtn');
const harditspeakBtn = document.getElementById('harditspeakBtn');
const rattanspeakBtn = document.getElementById('rattanspeakBtn');
const gifAnimationContainer = document.getElementById('gifAnimationContainer');

// Profile Upload Element
const profilePictureUpload = document.getElementById('profilePictureUpload');

// GIF Animation Modal Elements
const gifAnimationModal = document.getElementById('gifAnimationModal');
const gifAnimationModalClose = document.getElementById('gifAnimationModalClose');
const gifInvincibleBtn = document.getElementById('gifInvincibleBtn');
const gifSearchBtn = document.getElementById('gifSearchBtn');
const gifAnimationSearchModal = document.getElementById('gifAnimationSearchModal');
const gifAnimationSearchClose = document.getElementById('gifAnimationSearchClose');
const gifAnimationSearchInput = document.getElementById('gifAnimationSearchInput');
const gifAnimationSearchResults = document.getElementById('gifAnimationSearchResults');

// ========================================
// UTILITY FUNCTIONS
// ========================================

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
// AUTHENTICATION FUNCTIONALITY
// ========================================

/**
 * Check if user is already logged in via JWT token
 */
async function checkExistingLogin() {
  if (jwtToken) {
    try {
      const response = await fetch(`${API_BASE}/api/auth/validate`, {
        headers: {
          'Authorization': `Bearer ${jwtToken}`
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        currentNickname = data.user.username;
        currentUserId = data.user.userId;
        authScreen.classList.add('hidden');
        chatApp.classList.remove('hidden');
        connectWithToken();
        return true;
      }
    } catch (error) {
      console.error('Token validation failed:', error);
      localStorage.removeItem('jwtToken');
      jwtToken = null;
    }
  }
  return false;
}

/**
 * Connect to Socket.io with JWT token
 */
function connectWithToken() {
  socket.emit('auth', { token: jwtToken });
}

/**
 * Handle signup form submission
 */
signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('signupUsername').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const passwordConfirm = document.getElementById('signupPasswordConfirm').value;

  // Validation
  if (!username || !email || !password) {
    signupMessage.textContent = 'All fields are required';
    signupMessage.classList.add('error');
    return;
  }

  if (username.length < 3 || username.length > 20) {
    signupMessage.textContent = 'Username must be 3-20 characters';
    signupMessage.classList.add('error');
    return;
  }

  if (password.length < 6) {
    signupMessage.textContent = 'Password must be at least 6 characters';
    signupMessage.classList.add('error');
    return;
  }

  if (password !== passwordConfirm) {
    signupMessage.textContent = 'Passwords do not match';
    signupMessage.classList.add('error');
    return;
  }

  try {
    signupMessage.classList.remove('error', 'success');
    signupMessage.textContent = 'Creating account...';

    const response = await fetch(`${API_BASE}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error);
    }

    // Store JWT token
    jwtToken = data.token;
    localStorage.setItem('jwtToken', jwtToken);
    currentNickname = data.user.username;
    currentUserId = data.user.id;

    // Show success and transition to chat
    signupMessage.textContent = '✅ Account created! Entering chat...';
    signupMessage.classList.add('success');

    setTimeout(() => {
      authScreen.classList.add('hidden');
      chatApp.classList.remove('hidden');
      connectWithToken();
    }, 500);
  } catch (error) {
    signupMessage.textContent = error.message;
    signupMessage.classList.add('error');
    console.error('Signup error:', error);
  }
});

/**
 * Handle new login form submission (JWT-based)
 */
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  // Validation
  if (!username || !password) {
    loginMessage.textContent = 'Username and password required';
    loginMessage.classList.add('error');
    return;
  }

  try {
    loginMessage.classList.remove('error', 'success');
    loginMessage.textContent = 'Logging in...';

    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error);
    }

    // Store JWT token
    jwtToken = data.token;
    localStorage.setItem('jwtToken', jwtToken);
    currentNickname = data.user.username;
    currentUserId = data.user.id;

    // Show success and transition to chat
    loginMessage.textContent = '✅ Login successful! Entering chat...';
    loginMessage.classList.add('success');

    setTimeout(() => {
      authScreen.classList.add('hidden');
      chatApp.classList.remove('hidden');
      connectWithToken();
    }, 500);
  } catch (error) {
    loginMessage.textContent = error.message;
    loginMessage.classList.add('error');
    console.error('Login error:', error);
  }
});

/**
 * Handle auth tab switching
 */
authTabBtns.forEach((btn) => {
  btn.addEventListener('click', (e) => {
    const targetTab = btn.dataset.tab;

    // Update active tab button
    authTabBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    // Update active form
    document.querySelectorAll('.auth-form').forEach((form) => {
      form.classList.remove('active');
    });

    if (targetTab === 'login') {
      loginForm.classList.add('active');
      loginMessage.textContent = '';
      loginMessage.classList.remove('error', 'success');
    } else {
      signupForm.classList.add('active');
      signupMessage.textContent = '';
      signupMessage.classList.remove('error', 'success');
    }
  });
});

/**
 * Logout function
 */
function logout() {
  jwtToken = null;
  localStorage.removeItem('jwtToken');
  currentNickname = '';
  currentUserId = '';
  users.clear();
  messagesContainer.innerHTML = '';
  authScreen.classList.remove('hidden');
  chatApp.classList.add('hidden');
  socket.disconnect();
}

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

  // Handle Rattanspeak mode - silently discard message
  if (activeFunMode === 'rattanspeak') {
    // Random chance (1/1000000) for Rattan to say "hi"
    const randomNumber = Math.floor(Math.random() * 1000000) + 1;
    if (randomNumber === 676767) {
      socket.emit('rattan_message', { username: currentNickname });
    }
    messageInput.value = '';
    messageInput.focus();
    updateSendButtonState();
    return;
  }

  // Handle /transform command
  if (message.toLowerCase().startsWith('/transform ')) {
    const word = message.substring('/transform '.length).trim();
    if (word.length === 0) {
      addSystemNotification('❌ Please specify a word: /transform <word>');
    } else if (word.toLowerCase() === 'off') {
      socket.emit('stop_transform');
      addSystemNotification('✨ Message transformation disabled. KYS.');
    } else {
      socket.emit('set_transform_word', { word: word });
    }
    messageInput.value = '';
    messageInput.focus();
    updateSendButtonState();
    return;
  }

  // Create message object with type 'text'
  const messageData = {
    type: MESSAGE_TYPE.TEXT,
    content: message
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
 * Check if message should show header (name/timestamp)
 * Returns true if header should be shown, false if it should be hidden for consecutive messages
 */
function shouldShowMessageHeader(message) {
  const lastMessageElement = messagesContainer.querySelector('.message.user-message:not(.system):last-of-type');
  if (!lastMessageElement) return true; // First message, always show header

  const lastUserId = lastMessageElement.dataset.userId;
  const currentUserId = message.userId;

  if (lastUserId !== currentUserId) return true; // Different user, show header

  // Check time difference
  const lastTimestampText = lastMessageElement.querySelector('.timestamp')?.textContent;
  if (!lastTimestampText) return true;

  try {
    // Parse timestamps and check if they're within the group time
    const lastTime = new Date(lastMessageElement.dataset.timestamp);
    const currentTime = new Date(message.timestamp);
    return (currentTime - lastTime) > MESSAGE_GROUP_TIME;
  } catch (e) {
    return true; // If we can't parse, show header to be safe
  }
}

/**
 * Transform message based on active global fun mode
 * @param {String} content - Original message content
 * @returns {String} Transformed content
 */
function transformMessageContent(content) {
  if (activeFunMode === 'dheerajspeak') {
    // Each word ends with -poo
    return content
      .split(/(\s+)/)
      .map(word => {
        if (word.trim() === '') return word;
        if (word.endsWith('-poo')) return word;
        return word + '-poo';
      })
      .join('');
  }
  
  if (activeFunMode === 'harditspeak') {
    // Words on new lines with interjections, woah at the end
    const interjections = ['um', 'uh'];
    const words = content.split(/\s+/);
    let result = [];
    words.forEach((word, index) => {
      if (index > 0 && Math.random() < 0.3) {
        result.push(interjections[Math.floor(Math.random() * interjections.length)]);
      }
      result.push(word);
    });
    result.push('woah');
    return result.join('\n');
  }
  
  return content;
}

/**
 * Add a message to the chat
 * @param {Object} message - Message object { type, content, nickname, timestamp, userId, id }
 * @param {Boolean} isOwn - Whether the message is from the current user
 */
function addMessage(message, isOwn = false) {
  const isBot = message.nickname === 'epstein';
  const messageElement = document.createElement('div');
  messageElement.className = `message user-message ${isOwn ? 'own' : 'other'} ${isBot ? 'bot' : ''}`;
  messageElement.dataset.messageId = message.id;
  messageElement.dataset.userId = message.userId;
  messageElement.dataset.timestamp = message.timestamp; // Store for time comparison

  // Store userId mapping for sidebar lookups
  if (message.userId) {
    userIdMap[message.nickname] = message.userId;
  }

  // Create avatar
  const avatar = document.createElement('div');
  avatar.className = 'profile-avatar message-avatar';
  
  // Generate avatar based on nickname
  const firstLetter = message.nickname.charAt(0).toUpperCase();
  const colorHash = message.nickname.charCodeAt(0) % 5;
  const colors = ['🎨', '🎭', '🎪', '🎯', '🎲'];
  avatar.textContent = colors[colorHash];
  avatar.title = message.nickname;
  avatar.style.cursor = 'pointer';
  avatar.addEventListener('click', () => showUserProfile(message.userId || message.nickname, message.nickname));

  // Create main content wrapper with avatar
  const contentWrapper = document.createElement('div');
  contentWrapper.style.display = 'flex';
  contentWrapper.style.gap = '12px';
  contentWrapper.style.width = '100%';

  const messageContent = document.createElement('div');

  // Check if header should be shown for consecutive messages
  const showHeader = shouldShowMessageHeader(message);
  
  const header = document.createElement('div');
  header.className = 'message-header';
  if (!showHeader) {
    header.style.display = 'none';
    messageElement.classList.add('grouped-message'); // Add class when header is hidden
  }

  const nickname = document.createElement('span');
  nickname.className = 'nickname';
  nickname.textContent = message.nickname;
  nickname.style.cursor = 'pointer';
  nickname.addEventListener('click', () => showUserProfile(message.userId || message.nickname, message.nickname));

  const timestamp = document.createElement('span');
  timestamp.className = 'timestamp';
  timestamp.textContent = message.timestamp;

  header.appendChild(nickname);
  header.appendChild(timestamp);

  const content = document.createElement('div');
  content.className = 'message-content';

  // Transform message content based on global fun mode (but not for Rattanspeak - those messages don't show)
  let displayContent = message.content;
  if (activeFunMode !== 'rattanspeak') {
    displayContent = transformMessageContent(displayContent);
  }

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
    // Sanitize text content and highlight search terms
    if (searchTerm && displayContent.toLowerCase().includes(searchTerm.toLowerCase())) {
      const regex = new RegExp(`(${searchTerm})`, 'gi');
      displayContent = displayContent.replace(regex, '<span class="search-term">$1</span>');
      messageElement.classList.add('search-highlight');
    }
    content.innerHTML = escapeHTML(displayContent);
  }

  messageContent.appendChild(header);
  messageContent.appendChild(content);

  // Add reactions section
  const reactionsContainer = document.createElement('div');
  reactionsContainer.className = 'message-reactions';
  reactionsContainer.dataset.messageId = message.id;

  // Placeholder reactions (would be fetched from database)
  message.reactions = message.reactions || {};
  for (const [emoji, users] of Object.entries(message.reactions)) {
    const reaction = document.createElement('div');
    reaction.className = 'reaction';
    if (users.includes(currentNickname)) {
      reaction.classList.add('active');
    }
    reaction.innerHTML = `<span class="reaction-emoji">${emoji}</span><span class="reaction-count">${users.length}</span>`;
    reaction.addEventListener('click', () => toggleReaction(message.id, emoji));
    reactionsContainer.appendChild(reaction);
  }

  // Add reaction button
  const addReactionBtn = document.createElement('button');
  addReactionBtn.className = 'add-reaction-btn';
  addReactionBtn.textContent = '+';
  addReactionBtn.addEventListener('click', () => showReactionPicker(message.id, addReactionBtn));
  reactionsContainer.appendChild(addReactionBtn);

  messageContent.appendChild(reactionsContainer);

  contentWrapper.appendChild(avatar);
  contentWrapper.appendChild(messageContent);
  messageElement.appendChild(contentWrapper);

  // Store message for search
  allMessages.push(message);

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

/**
 * Show user profile modal
 * @param {String} userId - User ID
 * @param {String} username - Username
 */
function showUserProfile(userId, username) {
  editingProfileUserId = userId;
  const isOwnProfile = userId === currentUserId;

  // Function to display profile data
  const displayProfile = (data) => {
    // Update view mode
    document.getElementById('profileUsername').textContent = username;
    document.getElementById('profileMessageCount').textContent = data.messageCount || 0;
    document.getElementById('profileJoinDate').textContent = new Date(data.joinedAt).toLocaleDateString() || '-';
    document.getElementById('profileBio').textContent = data.bio || 'No bio';
    
    // Set avatar
    const avatar = data.avatar || '👤';
    document.getElementById('profileAvatar').textContent = avatar;
    currentProfileAvatar = avatar;

    // Show edit button only for own profile
    editProfileBtn.style.display = isOwnProfile ? 'block' : 'none';

    // Show view mode, hide edit mode
    profileViewMode.style.display = 'block';
    profileEditMode.style.display = 'none';
    editProfileBtn.onclick = () => enterEditMode(data);

    profileModal.classList.remove('hidden');
  };

  // Fetch user stats from server
  fetch(`${API_BASE}/api/users/${userId}/stats`, {
    headers: {
      'Authorization': `Bearer ${jwtToken}`
    }
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        displayProfile(data);
      } else {
        // If fetch failed (e.g., userId is a username), show a default profile view
        displayProfile({
          messageCount: 0,
          joinedAt: new Date(),
          bio: 'User profile',
          avatar: '👤'
        });
      }
    })
    .catch(err => {
      console.error('Error fetching user stats:', err);
      // Show a default profile view on error
      displayProfile({
        messageCount: 0,
        joinedAt: new Date(),
        bio: 'User profile',
        avatar: '👤'
      });
    });
}

/**
 * Enter profile edit mode
 * @param {Object} userData - User data from server
 */
function enterEditMode(userData) {
  profileViewMode.style.display = 'none';
  profileEditMode.style.display = 'block';

  // Set edit values
  profileAvatarInput.value = userData.avatar || '';
  document.getElementById('profileAvatarEdit').textContent = userData.avatar || '👤';
  profileBioEdit.value = userData.bio || '';
  updateBioCharCount();
}

/**
 * Exit edit mode and show view mode
 */
function exitEditMode() {
  profileViewMode.style.display = 'block';
  profileEditMode.style.display = 'none';
}

/**
 * Set profile avatar
 * @param {String} emoji - Emoji to set
 */
function setProfileAvatar(emoji) {
  profileAvatarInput.value = emoji;
  document.getElementById('profileAvatarEdit').textContent = emoji;
}

/**
 * Update bio character count
 */
function updateBioCharCount() {
  const count = profileBioEdit.value.length;
  bioCharCount.textContent = `${count}/200`;
}

/**
 * Save profile changes
 */
function saveProfileChanges() {
  const avatar = profileAvatarInput.value.trim() || '👤';
  const bio = profileBioEdit.value.trim();

  if (bio.length > 200) {
    alert('Bio must be 200 characters or less');
    return;
  }

  fetch(`${API_BASE}/api/users/${editingProfileUserId}/profile`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${jwtToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      avatar: avatar,
      bio: bio
    })
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        alert('Profile updated successfully!');
        exitEditMode();
        // Refresh profile display
        showUserProfile(editingProfileUserId, document.getElementById('profileUsername').textContent);
      } else {
        alert('Error saving profile: ' + (data.error || 'Unknown error'));
      }
    })
    .catch(err => {
      console.error('Error saving profile:', err);
      alert('Error saving profile');
    });
}

/**
 * Show emoji reaction picker
 * @param {String} messageId - Message ID
 * @param {Element} button - Button element that triggered this
 */
function showReactionPicker(messageId, button) {
  const emojis = ['👍', '❤️', '😂', '😮', '😢', '🎉', '🔥', '✨'];
  
  // Remove any existing picker
  const existingPicker = document.querySelector('.emoji-picker');
  if (existingPicker) {
    existingPicker.remove();
  }
  
  // Create emoji picker UI
  const picker = document.createElement('div');
  picker.className = 'emoji-picker';
  
  emojis.forEach(emoji => {
    const item = document.createElement('div');
    item.className = 'emoji-picker-item';
    item.textContent = emoji;
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => {
      toggleReaction(messageId, emoji);
      picker.remove();
    });
    picker.appendChild(item);
  });
  
  // Position picker relative to button
  button.parentElement.style.position = 'relative';
  button.parentElement.appendChild(picker);
}

/**
 * Play random GIF animation
 */
/**
 * Play a specific GIF animation
 * @param {string} gifUrl - URL of the GIF to play
 */
function playAnimatedGif(gifUrl) {
  socket.emit('play_gif', {
    username: currentNickname,
    gifUrl: gifUrl
  });
}

/**
 * Play the Invincible GIF animation
 */
function playInvincibleGif() {
  playAnimatedGif('@file:tracksuit-mark-invicible-mark.gif');
  closeGifAnimationModal();
}

/**
 * Open GIF animation options modal
 */
function openGifAnimationModal() {
  gifAnimationModal.classList.remove('hidden');
}

/**
 * Close GIF animation options modal
 */
function closeGifAnimationModal() {
  gifAnimationModal.classList.add('hidden');
}

/**
 * Open GIF animation search modal
 */
function openGifAnimationSearchModal() {
  gifAnimationSearchModal.classList.remove('hidden');
  gifAnimationSearchInput.focus();
  gifAnimationSearchResults.innerHTML = '<p class="gif-loading-text">Search for GIFs to get started</p>';
}

/**
 * Close GIF animation search modal
 */
function closeGifAnimationSearchModal() {
  gifAnimationSearchModal.classList.add('hidden');
  gifAnimationSearchInput.value = '';
}

/**
 * Search for GIFs to play as animation
 */
async function searchAnimationGifs(query) {
  if (!query.trim()) {
    gifAnimationSearchResults.innerHTML = '<p class="gif-loading-text">Search for GIFs to get started</p>';
    return;
  }

  gifAnimationSearchResults.innerHTML = '<p class="gif-loading-text">Loading...</p>';

  try {
    const url = `${GIPHY_SEARCH_URL}?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(query)}&limit=20&rating=PG`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.data.length === 0) {
      gifAnimationSearchResults.innerHTML = '<p class="gif-loading-text">No GIFs found. Try another search!</p>';
      return;
    }

    displayAnimationGifResults(data.data);
  } catch (error) {
    console.error('GIF search error:', error);
    gifAnimationSearchResults.innerHTML = '<p class="gif-error-text">Error searching GIFs. Please try again.</p>';
  }
}

/**
 * Display GIF search results for animation selection
 */
function displayAnimationGifResults(gifs) {
  gifAnimationSearchResults.innerHTML = '';

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
      playAnimatedGif(gif.images.original.url);
      closeGifAnimationSearchModal();
    });

    gifAnimationSearchResults.appendChild(gifItem);
  });
}

/**
 * Play a specific GIF animation (old function, kept for compatibility)
 */
function playRandomGif() {
  openGifAnimationModal();
}

/**
 * Display GIF animation on screen
 */
function displayGif(gifUrl) {
  const gif = document.createElement('img');
  gif.src = gifUrl;
  gif.style.position = 'fixed';
  
  // Random size (200-400px)
  const size = Math.random() * 200 + 200;
  gif.style.width = size + 'px';
  gif.style.height = 'auto';
  
  // Random position
  const maxX = window.innerWidth - size;
  const maxY = window.innerHeight - size;
  const x = Math.random() * maxX;
  const y = Math.random() * maxY;
  gif.style.left = x + 'px';
  gif.style.top = y + 'px';
  
  gif.style.zIndex = '101';
  gif.style.pointerEvents = 'none';
  gif.style.animation = 'fadeInOut 3s ease-in-out forwards';
  
  gifAnimationContainer.appendChild(gif);
  
  // Remove after animation completes
  setTimeout(() => {
    gif.remove();
  }, 3000);
}

/**
 * Play audio file for all users
 * @param {string} audioUrl - URL of the audio file to play
 */
function playAudioFile(audioUrl) {
  const audio = new Audio(audioUrl);
  audio.volume = 1.0; // Maximum volume
  audio.play().catch(err => {
    console.error('Error playing audio:', err);
  });
}

/**
 * Toggle reaction on a message
 * @param {String} messageId - Message ID
 * @param {String} emoji - Emoji to react with
 */
function toggleReaction(messageId, emoji) {
  socket.emit('toggle_reaction', {
    messageId: messageId,
    emoji: emoji,
    username: currentNickname
  });
}

/**
 * Filter messages by search term
 */
function filterMessagesBySearch() {
  const term = searchInput.value.trim().toLowerCase();
  searchTerm = term;

  if (term === '') {
    // Show all messages
    document.querySelectorAll('.message.user-message').forEach(msg => {
      msg.classList.remove('search-highlight');
      msg.style.display = '';
    });
    clearSearchBtn.style.display = 'none';
  } else {
    // Filter and highlight
    document.querySelectorAll('.message.user-message').forEach(msg => {
      const content = msg.textContent.toLowerCase();
      if (content.includes(term)) {
        msg.style.display = '';
        msg.classList.add('search-highlight');
      } else {
        msg.style.display = 'none';
      }
    });
    clearSearchBtn.style.display = 'block';
  }
}

/**
 * Clear search filter
 */
function clearSearch() {
  searchInput.value = '';
  filterMessagesBySearch();
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
    userItem.style.cursor = 'pointer';
    userItem.style.transition = 'all 0.2s';

    // Create avatar
    const colors = ['🎨', '🎭', '🎪', '🎯', '🎲'];
    const colorHash = nickname.charCodeAt(0) % 5;
    const avatar = document.createElement('span');
    avatar.textContent = colors[colorHash];
    avatar.style.marginRight = '8px';

    // Create name span
    const nameSpan = document.createElement('span');
    nameSpan.textContent = nickname;

    // Highlight if it's current user
    if (nickname === currentNickname) {
      userItem.style.color = '#00d4ff';
      userItem.style.fontWeight = 'bold';
      nameSpan.textContent = nickname + ' (you)';
    }

    userItem.appendChild(avatar);
    userItem.appendChild(nameSpan);

    // Click to show profile
    userItem.addEventListener('click', () => {
      let userId;
      if (nickname === currentNickname) {
        userId = currentUserId;
      } else {
        // Try to use stored userId from messages, otherwise use nickname
        userId = userIdMap[nickname] || nickname;
      }
      showUserProfile(userId, nickname);
    });

    userItem.addEventListener('mouseenter', () => {
      userItem.style.background = 'rgba(0, 212, 255, 0.1)';
      userItem.style.borderRadius = '4px';
    });

    userItem.addEventListener('mouseleave', () => {
      userItem.style.background = 'transparent';
    });

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
// SEARCH EVENT LISTENERS
// ========================================

/**
 * Search input event listener
 */
searchInput.addEventListener('input', filterMessagesBySearch);
clearSearchBtn.addEventListener('click', clearSearch);

// ========================================
// PROFILE MODAL EVENT LISTENERS
// ========================================

/**
 * Close profile modal
 */
profileModalClose.addEventListener('click', () => {
  profileModal.classList.add('hidden');
});

/**
 * Close profile modal when clicking outside
 */
profileModal.addEventListener('click', (e) => {
  if (e.target === profileModal) {
    profileModal.classList.add('hidden');
  }
});

// ========================================
// PROFILE EDITING EVENT LISTENERS
// ========================================

/**
 * Save profile changes
 */
saveProfileBtn.addEventListener('click', saveProfileChanges);

/**
 * Cancel edit mode
 */
cancelEditBtn.addEventListener('click', exitEditMode);

/**
 * Update bio character count
 */
profileBioEdit.addEventListener('input', updateBioCharCount);

// ========================================
// SEARCH TOGGLE EVENT LISTENERS
// ========================================

/**
 * Toggle search bar visibility
 */
searchToggleBtn.addEventListener('click', () => {
  searchCollapsed = !searchCollapsed;
  if (searchCollapsed) {
    searchInput.style.display = 'none';
    clearSearchBtn.style.display = 'none';
    searchToggleBtn.classList.add('collapsed');
    // Clear search when collapsing
    searchInput.value = '';
    filterMessagesBySearch();
  } else {
    searchInput.style.display = '';
    searchToggleBtn.classList.remove('collapsed');
    searchInput.focus();
  }
});

// ========================================
// FUN BUTTON EVENT LISTENERS
// ========================================

/**
 * Open fun options modal
 */
funButton.addEventListener('click', () => {
  funModal.classList.remove('hidden');
});

/**
 * Close fun modal
 */
funModalClose.addEventListener('click', () => {
  funModal.classList.add('hidden');
});

/**
 * Close fun modal when clicking outside
 */
funModal.addEventListener('click', (e) => {
  if (e.target === funModal) {
    funModal.classList.add('hidden');
  }
});

/**
 * Play GIF animation
 */
gifAnimationBtn.addEventListener('click', () => {
  openGifAnimationModal();
  funModal.classList.add('hidden');
});

/**
 * Close GIF animation modal
 */
gifAnimationModalClose.addEventListener('click', closeGifAnimationModal);

/**
 * Close GIF animation modal when clicking outside
 */
gifAnimationModal.addEventListener('click', (e) => {
  if (e.target === gifAnimationModal) {
    closeGifAnimationModal();
  }
});

/**
 * Play Invincible GIF
 */
gifInvincibleBtn.addEventListener('click', playInvincibleGif);

/**
 * Open GIF search modal
 */
gifSearchBtn.addEventListener('click', () => {
  closeGifAnimationModal();
  openGifAnimationSearchModal();
});

/**
 * Close GIF animation search modal
 */
gifAnimationSearchClose.addEventListener('click', closeGifAnimationSearchModal);

/**
 * Close GIF animation search modal when clicking outside
 */
gifAnimationSearchModal.addEventListener('click', (e) => {
  if (e.target === gifAnimationSearchModal) {
    closeGifAnimationSearchModal();
  }
});

/**
 * Search GIFs for animation with debouncing
 */
let gifAnimationSearchTimeout = null;
gifAnimationSearchInput.addEventListener('input', () => {
  clearTimeout(gifAnimationSearchTimeout);
  gifAnimationSearchTimeout = setTimeout(() => {
    searchAnimationGifs(gifAnimationSearchInput.value);
  }, 300);
});

/**
 * Transform messages
 */
messageTransformBtn.addEventListener('click', () => {
  const newWord = prompt('Enter a word to transform all messages into:', 'FOID!');
  if (newWord && newWord.trim()) {
    socket.emit('set_transform_word', { word: newWord.trim() });
    funModal.classList.add('hidden');
  }
});

/**
 * Play Quiet Mode audio
 */
quietModeBtn.addEventListener('click', () => {
  socket.emit('play_audio', {
    username: currentNickname,
    audioFile: '@file:chicken-on-tree-screaming.mp3'
  });
  funModal.classList.add('hidden');
  addSystemNotification('🔊 AAAAAHHHHHHH!!!');
});

/**
 * Toggle Dheerajspeak mode
 */
dheerajspeakBtn.addEventListener('click', () => {
  const newMode = activeFunMode === 'dheerajspeak' ? 'none' : 'dheerajspeak';
  socket.emit('set_fun_mode', {
    username: currentNickname,
    mode: newMode
  });
  funModal.classList.add('hidden');
});

/**
 * Toggle Harditspeak mode
 */
harditspeakBtn.addEventListener('click', () => {
  const newMode = activeFunMode === 'harditspeak' ? 'none' : 'harditspeak';
  socket.emit('set_fun_mode', {
    username: currentNickname,
    mode: newMode
  });
  funModal.classList.add('hidden');
});

/**
 * Toggle Rattanspeak mode
 */
rattanspeakBtn.addEventListener('click', () => {
  const newMode = activeFunMode === 'rattanspeak' ? 'none' : 'rattanspeak';
  socket.emit('set_fun_mode', {
    username: currentNickname,
    mode: newMode
  });
  funModal.classList.add('hidden');
});

/**
 * Handle profile picture upload
 */
if (profilePictureUpload) {
  profilePictureUpload.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target.result;
        setProfileAvatar(dataUrl);
        // Update the display
        document.getElementById('profileAvatarEdit').textContent = '';
        const img = document.createElement('img');
        img.src = dataUrl;
        img.style.width = '60px';
        img.style.height = '60px';
        img.style.borderRadius = '8px';
        img.style.objectFit = 'cover';
        document.getElementById('profileAvatarEdit').appendChild(img);
      };
      reader.readAsDataURL(file);
    }
  });
}

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
  const notificationText = `✓ ${data.username} joined the chat`;
  addSystemNotification(notificationText);
  userCountDisplay.textContent = data.userCount;
});

/**
 * Handle user disconnection notification
 */
socket.on('user_disconnected', (data) => {
  const notificationText = `✗ ${data.username} left the chat`;
  addSystemNotification(notificationText);
  userCountDisplay.textContent = data.userCount;
  
  // Remove from typing users
  typingUsers.delete(data.username);
  updateTypingIndicator();
});

/**
 * Handle active users list update
 */
socket.on('update_users', (data) => {
  updateUsersList(data.activeUsers);
});

/**
 * Handle message reaction updates
 */
socket.on('reaction_update', (data) => {
  const { messageId, reactions } = data;
  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
  if (messageElement) {
    const reactionsContainer = messageElement.querySelector('.message-reactions');
    if (reactionsContainer) {
      // Clear existing reactions
      reactionsContainer.querySelectorAll('.reaction').forEach(el => el.remove());
      
      // Add updated reactions
      for (const [emoji, users] of Object.entries(reactions)) {
        const reaction = document.createElement('div');
        reaction.className = 'reaction';
        if (users.includes(currentNickname)) {
          reaction.classList.add('active');
        }
        reaction.innerHTML = `<span class="reaction-emoji">${emoji}</span><span class="reaction-count">${users.length}</span>`;
        reaction.addEventListener('click', () => toggleReaction(messageId, emoji));
        reactionsContainer.insertBefore(reaction, reactionsContainer.lastChild);
      }
    }
  }
});

/**
 * Handle socket connection
 */
socket.on('connect', () => {
  console.log('Connected to server with ID:', socket.id);
  isConnected = true;
});

/**
 * Handle GIF animation broadcast
 */
socket.on('gif_animation', (data) => {
  displayGif(data.gifUrl);
  addSystemNotification(`🎬 ${data.username} played a random GIF!`);
});

/**
 * Handle audio broadcast (Quiet Mode)
 */
socket.on('play_audio', (data) => {
  playAudioFile(data.audioUrl);
  addSystemNotification(`🔊 ${data.username} played an audio clip!`);
});

/**
 * Handle message transformation
 */
socket.on('transform_message_start', (data) => {
  messageTransformActive = true;
  messageTransformWords = [data.word];
  addSystemNotification(`✨ All messages are now ${data.word}!`);
});

/**
 * Handle transform message stop
 */
socket.on('transform_message_stop', () => {
  messageTransformActive = false;
  messageTransformWords = [];
});

/**
 * Handle fun mode changes
 */
socket.on('fun_mode_changed', (data) => {
  const { mode, username } = data;
  activeFunMode = mode;
  
  if (mode === 'none') {
    addSystemNotification(`✨ Fun mode disabled by ${username}`);
  } else if (mode === 'dheerajspeak') {
    addSystemNotification(`💩 ${username} activated Dheerajspeak! Every word ends with -poo!`);
  } else if (mode === 'harditspeak') {
    addSystemNotification(`📺 ${username} activated Harditspeak! Words on new lines!`);
  } else if (mode === 'rattanspeak') {
    addSystemNotification(`🤐 ${username} activated Rattanspeak! Messages are silent...`);
  }
});

/**
 * Handle socket disconnection
 */
socket.on('disconnect', () => {
  console.log('Disconnected from server');
  isConnected = false;
  addSystemNotification('🚨 CHUD ALERT! reset browser, i added something new');
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
async function init() {
  console.log('🚀 Real-time Chat Application Initializing...');

  // Check if user is already logged in with JWT
  const existingLogin = await checkExistingLogin();

  if (!existingLogin) {
    // No existing login, show auth screen
    authScreen.classList.remove('hidden');
    chatApp.classList.add('hidden');
    document.getElementById('loginUsername').focus();
  }

  updateSendButtonState();
  console.log('✅ Real-time Chat Application Initialized');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
