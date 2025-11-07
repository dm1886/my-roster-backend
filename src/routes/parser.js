const express = require('express');
const router = express.Router();
const db = require('../config/db');
const jwt = require('jsonwebtoken');
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

// POST /api/parser/report-unknown
router.post('/report-unknown', auth, async (req, res) => {
  const requestLogger = logger.createRequestLogger({ route: 'report-unknown' });
  
  try {
    const {
      raw_text,
      iso_date,
      weekday,
      day_number,
      detected_kind,
      detected_type,
      rule_id,
      app_version,
      device_model,
      ios_version
    } = req.body;

    // Validate required fields
    if (!raw_text) {
      return res.status(400).json({ error: 'raw_text is required' });
    }

    requestLogger.info({ 
      userId: req.userId,
      iso_date,
      rawTextLength: raw_text.length 
    }, 'Unknown roster report received');

    // Get user's staff number
    const userResult = await db.query(
      'SELECT staff_number FROM users WHERE id = $1::uuid',
      [req.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const staffNumber = userResult.rows[0].staff_number;

    // Check if similar unknown roster already exists (avoid duplicates)
    // Using MD5 hash of raw_text for efficient duplicate detection
    const duplicateCheck = await db.query(
      `SELECT id, report_count FROM unknown_rosters 
       WHERE user_id = $1::uuid 
       AND md5(raw_text) = md5($2)
       AND iso_date = $3
       AND status = 'pending'
       LIMIT 1`,
      [req.userId, raw_text, iso_date]
    );

    let unknownRosterId;

    if (duplicateCheck.rows.length > 0) {
      // Update existing record - increment report count
      const existingId = duplicateCheck.rows[0].id;
      const newCount = duplicateCheck.rows[0].report_count + 1;

      await db.query(
        `UPDATE unknown_rosters 
         SET report_count = $1,
             last_reported_at = NOW()
         WHERE id = $2::uuid`,
        [newCount, existingId]
      );

      unknownRosterId = existingId;
      requestLogger.info({ 
        unknownRosterId,
        reportCount: newCount 
      }, 'Duplicate unknown roster - count incremented');

    } else {
      // Insert new unknown roster record
      const result = await db.query(
        `INSERT INTO unknown_rosters (
          user_id, staff_number, raw_text, iso_date, weekday, day_number,
          detected_kind, detected_type, rule_id,
          app_version, device_model, ios_version
        ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, reported_at`,
        [
          req.userId, staffNumber, raw_text, iso_date, weekday, day_number,
          detected_kind, detected_type, rule_id,
          app_version, device_model, ios_version
        ]
      );

      unknownRosterId = result.rows[0].id;
      requestLogger.info({ 
        unknownRosterId,
        reportedAt: result.rows[0].reported_at 
      }, 'New unknown roster reported successfully');
    }

    res.status(201).json({
      message: 'Unknown roster reported successfully',
      id: unknownRosterId
    });

  } catch (error) {
    requestLogger.error({ error: error.message }, 'Failed to report unknown roster');
    res.status(500).json({ error: 'Failed to report unknown roster' });
  }
});

// GET /api/parser/unknown-rosters - List all unknown rosters (for admin/debugging)
router.get('/unknown-rosters', auth, async (req, res) => {
  const requestLogger = logger.createRequestLogger({ route: 'list-unknown' });
  
  try {
    const { status = 'pending', limit = 50, offset = 0 } = req.query;

    const result = await db.query(
      `SELECT 
        id, user_id, staff_number, raw_text, iso_date, weekday, day_number,
        detected_kind, detected_type, rule_id,
        app_version, device_model, ios_version,
        status, report_count, reported_at, last_reported_at
       FROM unknown_rosters
       WHERE status = $1
       ORDER BY last_reported_at DESC
       LIMIT $2 OFFSET $3`,
      [status, limit, offset]
    );

    // Get total count
    const countResult = await db.query(
      'SELECT COUNT(*) FROM unknown_rosters WHERE status = $1',
      [status]
    );

    requestLogger.info({ 
      status,
      count: result.rows.length,
      total: parseInt(countResult.rows[0].count)
    }, 'Unknown rosters listed');

    res.json({
      unknown_rosters: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    requestLogger.error({ error: error.message }, 'Failed to list unknown rosters');
    res.status(500).json({ error: 'Failed to list unknown rosters' });
  }
});

// GET /api/parser/unknown-rosters/stats - Get statistics
router.get('/unknown-rosters/stats', auth, async (req, res) => {
  const requestLogger = logger.createRequestLogger({ route: 'unknown-stats' });
  
  try {
    const stats = await db.query(
      `SELECT 
        status,
        COUNT(*) as count,
        SUM(report_count) as total_reports
       FROM unknown_rosters
       GROUP BY status`
    );

    const recentCount = await db.query(
      `SELECT COUNT(*) FROM unknown_rosters 
       WHERE reported_at > NOW() - INTERVAL '7 days'`
    );

    requestLogger.info('Unknown rosters stats retrieved');

    res.json({
      by_status: stats.rows,
      recent_7_days: parseInt(recentCount.rows[0].count)
    });

  } catch (error) {
    requestLogger.error({ error: error.message }, 'Failed to get stats');
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// PATCH /api/parser/unknown-rosters/:id - Update status (mark as resolved/ignored)
router.patch('/unknown-rosters/:id', auth, async (req, res) => {
  const requestLogger = logger.createRequestLogger({ route: 'update-unknown' });
  
  try {
    const { id } = req.params;
    const { status, resolution_notes } = req.body;

    if (!['resolved', 'ignored', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be: resolved, ignored, or pending' });
    }

    // Get user info for resolved_by
    const userResult = await db.query(
      'SELECT email FROM users WHERE id = $1::uuid',
      [req.userId]
    );

    const resolvedBy = userResult.rows[0]?.email || 'unknown';

    const result = await db.query(
      `UPDATE unknown_rosters 
       SET status = $1,
           resolved_at = CASE WHEN $1 != 'pending' THEN NOW() ELSE NULL END,
           resolved_by = CASE WHEN $1 != 'pending' THEN $2 ELSE NULL END,
           resolution_notes = $3
       WHERE id = $4::uuid
       RETURNING id, status, resolved_at`,
      [status, resolvedBy, resolution_notes, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Unknown roster not found' });
    }

    requestLogger.info({ 
      unknownRosterId: id,
      newStatus: status 
    }, 'Unknown roster status updated');

    res.json({
      message: 'Unknown roster updated successfully',
      unknown_roster: result.rows[0]
    });

  } catch (error) {
    requestLogger.error({ error: error.message }, 'Failed to update unknown roster');
    res.status(500).json({ error: 'Failed to update unknown roster' });
  }
});

module.exports = router;
