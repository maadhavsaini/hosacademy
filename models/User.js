const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');

class User {
  /**
   * Create a new user with hashed password
   */
  static create(username, email, password, avatar_url = null) {
    try {
      // Hash password with bcrypt synchronously (10 rounds)
      const hash = bcrypt.hashSync(password, 10);

      const userId = uuidv4();
      const stmt = db.prepare(
        `INSERT INTO users (id, username, email, password_hash, avatar_url)
         VALUES (?, ?, ?, ?, ?)`
      );

      stmt.run(userId, username, email, hash, avatar_url);

      return { id: userId, username, email, avatar_url };
    } catch (error) {
      if (error.message.includes('UNIQUE constraint failed')) {
        throw new Error('Username or email already exists');
      } else {
        throw new Error(`Failed to create user: ${error.message}`);
      }
    }
  }

  /**
   * Find user by username and verify password
   */
  static authenticate(username, password) {
    try {
      const stmt = db.prepare(
        `SELECT id, username, email, password_hash, avatar_url FROM users WHERE username = ?`
      );

      const row = stmt.get(username);

      if (!row) {
        throw new Error('User not found');
      }

      // Compare password with hash synchronously
      const isMatch = bcrypt.compareSync(password, row.password_hash);

      if (!isMatch) {
        throw new Error('Invalid password');
      }

      // Password matches, return user (without hash)
      return {
        id: row.id,
        username: row.username,
        email: row.email,
        avatar_url: row.avatar_url
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Find user by ID
   */
  static findById(userId) {
    try {
      const stmt = db.prepare(
        `SELECT id, username, email, avatar_url, bio, created_at FROM users WHERE id = ?`
      );

      return stmt.get(userId) || null;
    } catch (error) {
      throw new Error(`Database error: ${error.message}`);
    }
  }

  /**
   * Find user by username
   */
  static findByUsername(username) {
    try {
      const stmt = db.prepare(
        `SELECT id, username, email, avatar_url, bio, created_at FROM users WHERE username = ?`
      );

      return stmt.get(username) || null;
    } catch (error) {
      throw new Error(`Database error: ${error.message}`);
    }
  }

  /**
   * Update user profile
   */
  static updateProfile(userId, updates) {
    try {
      const allowedFields = ['avatar_url', 'bio'];
      const fields = [];
      const values = [];

      Object.keys(updates).forEach((key) => {
        if (allowedFields.includes(key)) {
          fields.push(`${key} = ?`);
          values.push(updates[key]);
        }
      });

      if (fields.length === 0) {
        throw new Error('No valid fields to update');
      }

      values.push(userId);
      const query = `UPDATE users SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;

      const stmt = db.prepare(query);
      stmt.run(...values);

      return { success: true };
    } catch (error) {
      throw new Error(`Failed to update profile: ${error.message}`);
    }
  }

  /**
   * Get user statistics
   */
  static getStats(userId) {
    try {
      const stmt = db.prepare(
        `SELECT COUNT(*) as total_messages FROM messages WHERE user_id = ?`
      );

      const row = stmt.get(userId);

      return {
        total_messages: row.total_messages || 0
      };
    } catch (error) {
      throw new Error(`Database error: ${error.message}`);
    }
  }
}

module.exports = User;
