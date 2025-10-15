const express = require('express');
const router = express.Router();
const db = require('../config/db');
const jwt = require('jsonwebtoken');
const { decrypt } = require('../utils/crypto');
const logger = require('../utils/logger');

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

// POST /api/icrew/monthly/download
router.post('/download', auth, async (req, res) => {
  const requestLogger = logger.createRequestLogger({ route: 'monthly-download' });
  
  try {
    const { month, year } = req.body;

    if (!month || !year) {
      return res.status(400).json({ error: 'Month and year required' });
    }

    if (month < 1 || month > 12) {
      return res.status(400).json({ error: 'Month must be between 1 and 12' });
    }

    // Get user's iCrew credentials
    const result = await db.query(
      'SELECT icrew_username, icrew_password_encrypted FROM users WHERE id = $1::uuid',
      [req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { icrew_username, icrew_password_encrypted } = result.rows[0];

    if (!icrew_username || !icrew_password_encrypted) {
      return res.status(400).json({ error: 'No iCrew credentials saved' });
    }

    // Decrypt password
    const icrewPassword = decrypt(icrew_password_encrypted);

    requestLogger.info({ 
      crewId: icrew_username, 
      month, 
      year 
    }, 'Monthly roster download requested');

    // Create NEW instance for this request
    const ICrewMonthlyService = require('../services/icrewMonthlyService');
    const icrewService = new ICrewMonthlyService(icrew_username);

    // Login to iCrew
    const client = await icrewService.login(icrew_username, icrewPassword);

    // Download roster
    const pdfBuffer = await icrewService.downloadMonthlyRoster(client, month, year);

    // Send PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="roster_${year}_${month}.pdf"`);
    res.send(pdfBuffer);

    requestLogger.info({ 
      crewId: icrew_username,
      size: pdfBuffer.length 
    }, 'Monthly roster sent successfully');

  } catch (error) {
    requestLogger.error({ error: error.message }, 'Monthly roster download failed');
    
    if (error.message.includes('Invalid iCrew credentials')) {
      return res.status(401).json({ error: 'Invalid iCrew credentials' });
    }

    if (error.message.includes('ICREW_NOTICE|||')) {
      const noticeContent = error.message.replace('ICREW_NOTICE|||', '');
      return res.status(403).json({ 
        error: 'Notice from iCrew',
        notice: noticeContent,
        message: 'Please log in to the iCrew website to acknowledge this notice.'
      });
    }
    
    res.status(500).json({ error: 'Failed to download roster: ' + error.message });
  }
});

module.exports = router;