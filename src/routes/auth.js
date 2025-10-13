// src/routes/auth.js
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('../config/db');
const { sendPasswordResetEmail } = require('../services/email');
const crypto = require('crypto');
const router = express.Router();
const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

function signToken(user) {
  return jwt.sign(
    { 
      sub: user.id, 
      email: user.email, 
      staffNumber: user.staff_number 
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { staff_number, email, password, first_name, last_name, rank } = req.body;
    
    // Validate required fields
    if (!email || !password || !first_name || !last_name || !staff_number) {
      return res.status(400).json({ 
        error: 'Missing required fields: staff_number, email, password, first_name, last_name' 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password length
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check if user already exists
    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1 OR staff_number = $2',
      [email.toLowerCase(), staff_number]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ 
        error: 'Email or staff number already exists' 
      });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, rounds);
    
    // Check if this should be the current user (first user registered)
    const userCount = await db.query('SELECT COUNT(*) as count FROM users');
    const isFirstUser = parseInt(userCount.rows[0].count) === 0;

    // Insert new user
    const { rows } = await db.query(
      `INSERT INTO users (
        staff_number, email, password_hash, first_name, last_name, rank, is_current_user
      )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, staff_number, email, first_name, last_name, rank, 
                 is_current_user, registered_at, last_login_at`,
      [
        staff_number, 
        email.toLowerCase(), 
        password_hash, 
        first_name, 
        last_name, 
        rank || null,
        isFirstUser
      ]
    );

    const user = rows[0];
    const token = signToken(user);

    console.log(`✅ User registered: ${user.email} (${user.staff_number})`);

    res.status(201).json({ user, token });
    
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ error: 'Internal server error during registration' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Find user by email
    const { rows } = await db.query(
      `SELECT id, email, password_hash, staff_number, first_name, last_name, rank,
              is_current_user, registered_at, last_login_at 
       FROM users 
       WHERE email = $1`,
      [email.toLowerCase()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];

    // Verify password
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login time
    await db.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [user.id]
    );

    // Generate token
    const token = signToken(user);

    // Remove password hash from response
    delete user.password_hash;

    console.log(`✅ User logged in: ${user.email}`);

    res.json({ user, token });
    
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ error: 'Internal server error during login' });
  }
});

// GET /api/auth/verify - Verify JWT token
router.get('/verify', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const { rows } = await db.query(
      `SELECT id, email, staff_number, first_name, last_name, rank,
              is_current_user, registered_at, last_login_at
       FROM users 
       WHERE id = $1::uuid`,
      [decoded.sub]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({ user: rows[0], valid: true });
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    console.error('❌ Token verification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/auth/delete - Delete user account
router.delete('/delete', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const result = await db.query(
      'DELETE FROM users WHERE id = $1::uuid RETURNING email, staff_number',
      [decoded.sub]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✅ User deleted: ${result.rows[0].email} (${result.rows[0].staff_number})`);

    res.json({ 
      message: 'Account deleted successfully',
      email: result.rows[0].email 
    });
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    console.error('❌ Delete account error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/check-email - Check if email exists
router.post('/check-email', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    const { rows } = await db.query(
      'SELECT id, email, staff_number, first_name, last_name FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (rows.length > 0) {
      res.json({ 
        exists: true,
        email: rows[0].email,
        staff_number: rows[0].staff_number,
        name: `${rows[0].first_name} ${rows[0].last_name}`
      });
    } else {
      res.json({ exists: false });
    }
    
  } catch (error) {
    console.error('❌ Check email error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/auth/profile - Update user profile
router.put('/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    const { email, first_name, last_name, rank, password } = req.body;

    if (!email || !first_name || !last_name) {
      return res.status(400).json({ error: 'Email, first name, and last name are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const existingUser = await db.query(
      'SELECT id FROM users WHERE email = $1 AND id != $2::uuid',
      [email.toLowerCase(), decoded.sub]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({ error: 'Email is already taken by another user' });
    }

    let updateQuery = `
      UPDATE users 
      SET email = $1, first_name = $2, last_name = $3, rank = $4, updated_at = NOW()
    `;
    let queryParams = [email.toLowerCase(), first_name, last_name, rank || null];
    let paramCount = 4;

    if (password && password.length >= 6) {
      const password_hash = await bcrypt.hash(password, rounds);
      updateQuery += `, password_hash = $${paramCount + 1}`;
      queryParams.push(password_hash);
      paramCount++;
    } else if (password && password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    updateQuery += ` WHERE id = $${paramCount + 1}::uuid RETURNING id, email, staff_number, first_name, last_name, rank, is_current_user, registered_at, last_login_at`;
    queryParams.push(decoded.sub);

    const { rows } = await db.query(updateQuery, queryParams);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUser = rows[0];

    console.log(`✅ Profile updated: ${updatedUser.email} (${updatedUser.staff_number})`);

    res.json({ 
      user: updatedUser,
      message: 'Profile updated successfully'
    });
    
  } catch (error) {
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    console.error('❌ Profile update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ==================== 🆕 PASSWORD RESET ROUTES ====================

// Request Password Reset
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Find user
    const result = await db.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
      [email]
    );

    // Always return success (don't reveal if email exists)
    if (result.rows.length === 0) {
      console.log(`⚠️ Password reset requested for non-existent email: ${email}`);
      return res.json({ message: 'If that email exists, a reset link has been sent' });
    }

    const user = result.rows[0];

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour

    // Save token to database
    await db.query(
      'UPDATE users SET reset_password_token = $1, reset_password_expires = $2 WHERE id = $3',
      [resetToken, resetTokenExpiry, user.id]
    );

    // Send email
    try {
      await sendPasswordResetEmail(user.email, resetToken);
      console.log(`✅ Password reset email sent to: ${user.email}`);
    } catch (emailError) {
      console.error('❌ Failed to send email:', emailError);
      return res.status(500).json({ error: 'Failed to send reset email' });
    }

    res.json({ message: 'Password reset link sent to email' });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Reset Password with Token
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ error: 'Token and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Find user with valid token
    const result = await db.query(
      'SELECT * FROM users WHERE reset_password_token = $1 AND reset_password_expires > $2',
      [token, Date.now()]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const user = result.rows[0];

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, parseInt(process.env.BCRYPT_ROUNDS) || 12);

    // Update password and clear reset token
    await db.query(
      'UPDATE users SET password_hash = $1, reset_password_token = NULL, reset_password_expires = NULL WHERE id = $2',
      [hashedPassword, user.id]
    );

    console.log(`✅ Password reset successful for user: ${user.email}`);

    res.json({ message: 'Password reset successful' });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;