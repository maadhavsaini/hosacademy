// ========================================
// SOCKET.IO CONNECTION SETUP
// ========================================

const socket = io();

// ========================================
// STATE VARIABLES
// ========================================

let currentNickname = '';
let isConnected = false;
const MAX_MESSAGE_LENGTH = 500;

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

    // Prevent special characters and numbers only
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

    // Validation
    if (!message) {
        return;
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
        alert(`Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters`);
        return;
    }

    // Emit message to server
    socket.emit('send_message', { text: message });

    // Clear input
    messageInput.value = '';
    messageInput.focus();
});

// ========================================
// MESSAGE RENDERING
// ========================================

/**
 * Add a user message to the chat
 * @param {Object} message - Message object with nickname, text, and timestamp
 * @param {Boolean} isOwn - Whether the message is from the current user
 */
function addUserMessage(message, isOwn = false) {
    const messageElement = document.createElement('div');
    messageElement.className = `message user-message ${isOwn ? 'own' : ''}`;

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
    content.textContent = message.text;
    content.style.wordWrap = 'break-word';

    messageElement.appendChild(header);
    messageElement.appendChild(content);

    removeWelcomeMessageIfNeeded();
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
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
    scrollToBottom();
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

/**
 * Scroll chat to the bottom
 */
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Scroll to bottom when messages container height changes
const observer = new MutationObserver(() => {
    scrollToBottom();
});

observer.observe(messagesContainer, {
    childList: true,
    subtree: true
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
// SOCKET.IO EVENT LISTENERS
// ========================================

/**
 * Handle receiving a message
 */
socket.on('receive_message', (message) => {
    const isOwn = message.nickname === currentNickname;
    addUserMessage(message, isOwn);
});

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
    // Focus on nickname input on page load
    nicknameInput.focus();

    // Log to console
    console.log('Real-time Chat Application Initialized');
    console.log('Waiting for nickname input...');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Format timestamp
 * @param {Date} date - Date object
 * @returns {String} - Formatted time string
 */
function formatTime(date) {
    return new Date(date).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

/**
 * Sanitize user input to prevent XSS
 * @param {String} text - User input text
 * @returns {String} - Sanitized text
 */
function sanitizeInput(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ========================================
// KEYBOARD SHORTCUTS & HELPERS
// ========================================

/**
 * Add keyboard shortcut for focusing message input
 */
document.addEventListener('keydown', (e) => {
    // Alt + C to focus message input
    if (e.altKey && e.key === 'c' && !loginScreen.classList.contains('hidden') === false) {
        messageInput.focus();
        e.preventDefault();
    }
});
