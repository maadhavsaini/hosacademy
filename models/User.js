const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const db = require('../database');

class User {
  /**
   * Create a new user with hashed password
   */
  static async create(username, email, password, avatar_url = null) {
    return new Promise((resolve, reject) => {
      // Hash password with bcrypt (10 rounds)
      bcrypt.hash(password, 10, (err, hash) => {
        if (err) {
          reject(new Error(`Password hashing failed: ${err.message}`));
          return;
        }

        const userId = uuidv4();
        db.run(
          `INSERT INTO users (id, username, email, password_hash, avatar_url)
           VALUES (?, ?, ?, ?, ?)`,
          [userId, username, email, hash, avatar_url],
          function (err) {
            if (err) {
              if (err.message.includes('UNIQUE constraint failed')) {
                reject(new Error('Username or email already exists'));
              } else {
                reject(new Error(`Failed to create user: ${err.message}`));
              }
            } else {
              resolve({ id: userId, username, email, avatar_url });
            }
          }
        );
      });
    });
  }

  /**
   * Find user by username and verify password
   */
  static async authenticate(username, password) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT id, username, email, password_hash, avatar_url FROM users WHERE username = ?`,
        [username],
        (err, row) => {
          if (err) {
            reject(new Error(`Database error: ${err.message}`));
            return;
          }

          if (!row) {
            reject(new Error('User not found'));
            return;
          }

          // Compare password with hash
          bcrypt.compare(password, row.password_hash, (err, isMatch) => {
            if (err) {
              reject(new Error(`Password comparison failed: ${err.message}`));
              return;
            }

            if (!isMatch) {
              reject(new Error('Invalid password'));
              return;
            }

            // Password matches, return user (without hash)
            resolve({
              id: row.id,
              username: row.username,
              email: row.email,
              avatar_url: row.avatar_url
            });
          });
        }
      );
    });
  }

  /**
   * Find user by ID
   */
  static async findById(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT id, username, email, avatar_url, bio, created_at FROM users WHERE id = ?`,
        [userId],
        (err, row) => {
          if (err) {
            reject(new Error(`Database error: ${err.message}`));
          } else {
            resolve(row || null);
          }
        }
      );
    });
  }

  /**
   * Find user by username
   */
  static async findByUsername(username) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT id, username, email, avatar_url, bio, created_at FROM users WHERE username = ?`,
        [username],
        (err, row) => {
          if (err) {
            reject(new Error(`Database error: ${err.message}`));
          } else {
            resolve(row || null);
          }
        }
      );
    });
  }

  /**
   * Update user profile
   */
  static async updateProfile(userId, updates) {
    return new Promise((resolve, reject) => {
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
        reject(new Error('No valid fields to update'));
        return;
      }

      values.push(userId);
      const query = `UPDATE users SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;

      db.run(query, values, (err) => {
        if (err) {
          reject(new Error(`Failed to update profile: ${err.message}`));
        } else {
          resolve({ success: true });
        }
      });
    });
  }

  /**
   * Get user statistics
   */
  static async getStats(userId) {
    return new Promise((resolve, reject) => {
      db.get(
        `SELECT COUNT(*) as total_messages FROM messages WHERE user_id = ?`,
        [userId],
        (err, row) => {
          if (err) {
            reject(new Error(`Database error: ${err.message}`));
          } else {
            resolve({
              total_messages: row.total_messages || 0
            });
          }
        }
      );
    });
  }
}

module.exports = User;
