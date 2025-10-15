const express = require('express');
const router = express.Router();
const db = require('../config/db');
const jwt = require('jsonwebtoken');
const { encrypt, decrypt } = require('../utils/crypto');

// Middleware to verify JWT
const auth = (req, res, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.sub;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// POST /api/icrew/save-credentials
router.post('/save-credentials', auth, async (req, res) => {
  try {
    const { icrew_username, icrew_password } = req.body;

    if (!icrew_username || !icrew_password) {
      return res.status(400).json({ error: 'iCrew username and password required' });
    }

    // Encrypt password
    const encryptedPassword = encrypt(icrew_password);

    // Update user record
    const result = await db.query(
      `UPDATE users 
       SET icrew_username = $1, 
           icrew_password_encrypted = $2,
           icrew_credentials_updated_at = NOW()
       WHERE id = $3::uuid
       RETURNING id, icrew_username, icrew_credentials_updated_at`,
      [icrew_username, encryptedPassword, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✅ iCrew credentials saved for user: ${req.userId}`);

    res.json({ 
      message: 'iCrew credentials saved successfully',
      updated_at: result.rows[0].icrew_credentials_updated_at
    });

  } catch (error) {
    console.error('❌ Save credentials error:', error);
    res.status(500).json({ error: 'Failed to save credentials' });
  }
});

// GET /api/icrew/has-credentials
router.get('/has-credentials', auth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT icrew_username, icrew_credentials_updated_at FROM users WHERE id = $1::uuid',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hasCredentials = !!result.rows[0].icrew_username;

    res.json({ 
      has_credentials: hasCredentials,
      username: result.rows[0].icrew_username,
      updated_at: result.rows[0].icrew_credentials_updated_at
    });

  } catch (error) {
    console.error('❌ Check credentials error:', error);
    res.status(500).json({ error: 'Failed to check credentials' });
  }
});

// DELETE /api/icrew/delete-credentials
router.delete('/delete-credentials', auth, async (req, res) => {
  try {
    await db.query(
      `UPDATE users 
       SET icrew_username = NULL, 
           icrew_password_encrypted = NULL,
           icrew_credentials_updated_at = NULL
       WHERE id = $1::uuid`,
      [req.userId]
    );

    console.log(`✅ iCrew credentials deleted for user: ${req.userId}`);

    res.json({ message: 'iCrew credentials deleted successfully' });

  } catch (error) {
    console.error('❌ Delete credentials error:', error);
    res.status(500).json({ error: 'Failed to delete credentials' });
  }
});

module.exports = router;