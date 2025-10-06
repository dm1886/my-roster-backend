const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const db = require('../config/db');

const router = express.Router();
const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role || 'user' },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { staff_id, email, password, first_name, last_name, rank } = req.body;
    if (!email || !password || !first_name || !last_name || !staff_id)
      return res.status(400).json({ error: 'missing fields' });

    const exists = await db.query('SELECT 1 FROM users WHERE email=$1 OR staff_id=$2', [email, staff_id]);
    if (exists.rowCount) return res.status(409).json({ error: 'email or staff_id already exists' });

    const password_hash = await bcrypt.hash(password, rounds);
    const { rows } = await db.query(
      `INSERT INTO users (staff_id, email, password_hash, first_name, last_name, rank)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, staff_id, email, first_name, last_name, rank, created_at`,
      [staff_id, email, password_hash, first_name, last_name, rank ?? null]
    );

    const user = rows[0];
    const token = signToken(user);
    res.status(201).json({ user, token });
  } catch (e) {
    console.error('register error', e);
    res.status(500).json({ error: 'internal error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const { rows } = await db.query(
      'SELECT id, email, password_hash, staff_id, first_name, last_name, rank FROM users WHERE email=$1',
      [email]
    );
    if (!rows.length) return res.status(401).json({ error: 'invalid credentials' });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });

    const token = signToken(user);
    delete user.password_hash;
    res.json({ user, token });
  } catch (e) {
    console.error('login error', e);
    res.status(500).json({ error: 'internal error' });
  }
});

module.exports = router;