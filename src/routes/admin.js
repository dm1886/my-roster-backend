const express = require('express');
const router = express.Router();
const db = require('../config/db');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// Simple admin authentication middleware
const adminAuth = (req, res, next) => {
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

// GET /api/admin/stats - Dashboard statistics
router.get('/stats', adminAuth, async (req, res) => {
  const requestLogger = logger.createRequestLogger({ route: 'admin-stats' });
  
  try {
    // Total users
    const usersResult = await db.query('SELECT COUNT(*) FROM users');
    const totalUsers = parseInt(usersResult.rows[0].count);

    // Users registered in last 7 days
    const recentUsersResult = await db.query(
      'SELECT COUNT(*) FROM users WHERE registered_at > NOW() - INTERVAL \'7 days\''
    );
    const recentUsers = parseInt(recentUsersResult.rows[0].count);

    // Unknown rosters by status
    const unknownStatsResult = await db.query(
      `SELECT 
        status,
        COUNT(*) as count,
        SUM(report_count) as total_reports
       FROM unknown_rosters
       GROUP BY status`
    );

    // Recent unknown rosters (last 7 days)
    const recentUnknownResult = await db.query(
      `SELECT COUNT(*) FROM unknown_rosters 
       WHERE reported_at > NOW() - INTERVAL '7 days'`
    );
    const recentUnknown = parseInt(recentUnknownResult.rows[0].count);

    // Most common unknown patterns
    const patternsResult = await db.query(
      `SELECT 
        LEFT(raw_text, 50) as pattern,
        COUNT(*) as occurrences,
        SUM(report_count) as total_reports
       FROM unknown_rosters
       WHERE status = 'pending'
       GROUP BY LEFT(raw_text, 50)
       ORDER BY total_reports DESC
       LIMIT 5`
    );

    requestLogger.info('Admin stats retrieved');

    res.json({
      users: {
        total: totalUsers,
        recent_7_days: recentUsers
      },
      unknown_rosters: {
        by_status: unknownStatsResult.rows,
        recent_7_days: recentUnknown,
        top_patterns: patternsResult.rows
      }
    });

  } catch (error) {
    requestLogger.error({ error: error.message }, 'Failed to get admin stats');
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// GET /api/admin/users - List all users
router.get('/users', adminAuth, async (req, res) => {
  const requestLogger = logger.createRequestLogger({ route: 'admin-users' });
  
  try {
    const { limit = 50, offset = 0, search = '' } = req.query;

    let query = `
      SELECT 
        id, staff_number, email, first_name, last_name, rank,
        airline_code, registered_at, last_login_at
      FROM users
    `;
    let params = [];

    if (search) {
      query += ` WHERE 
        email ILIKE $1 OR 
        staff_number ILIKE $1 OR 
        first_name ILIKE $1 OR 
        last_name ILIKE $1`;
      params.push(`%${search}%`);
      query += ` ORDER BY registered_at DESC LIMIT $2 OFFSET $3`;
      params.push(limit, offset);
    } else {
      query += ` ORDER BY registered_at DESC LIMIT $1 OFFSET $2`;
      params = [limit, offset];
    }

    const result = await db.query(query, params);

    // Get total count
    const countQuery = search 
      ? `SELECT COUNT(*) FROM users WHERE 
         email ILIKE $1 OR staff_number ILIKE $1 OR 
         first_name ILIKE $1 OR last_name ILIKE $1`
      : 'SELECT COUNT(*) FROM users';
    const countParams = search ? [`%${search}%`] : [];
    const countResult = await db.query(countQuery, countParams);

    requestLogger.info({ 
      count: result.rows.length,
      total: parseInt(countResult.rows[0].count)
    }, 'Admin users listed');

    res.json({
      users: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    requestLogger.error({ error: error.message }, 'Failed to list users');
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// GET /api/admin/unknown-rosters - List unknown rosters with filters
router.get('/unknown-rosters', adminAuth, async (req, res) => {
  const requestLogger = logger.createRequestLogger({ route: 'admin-unknown' });
  
  try {
    const { 
      status = 'pending', 
      limit = 50, 
      offset = 0,
      search = '',
      sort = 'last_reported_at',
      order = 'DESC'
    } = req.query;

    let query = `
      SELECT 
        ur.id, ur.user_id, ur.staff_number, ur.raw_text, 
        ur.iso_date, ur.weekday, ur.day_number,
        ur.detected_kind, ur.detected_type, ur.rule_id,
        ur.app_version, ur.device_model, ur.ios_version,
        ur.status, ur.report_count, ur.reported_at, ur.last_reported_at,
        ur.resolved_by, ur.resolution_notes,
        u.email, u.first_name, u.last_name
      FROM unknown_rosters ur
      LEFT JOIN users u ON ur.user_id = u.id
      WHERE ur.status = $1
    `;
    let params = [status];
    let paramIndex = 2;

    if (search) {
      query += ` AND (ur.raw_text ILIKE $${paramIndex} OR ur.staff_number ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    const validSorts = ['last_reported_at', 'reported_at', 'report_count'];
    const sortColumn = validSorts.includes(sort) ? sort : 'last_reported_at';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    query += ` ORDER BY ur.${sortColumn} ${sortOrder} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) FROM unknown_rosters WHERE status = $1';
    let countParams = [status];
    if (search) {
      countQuery += ' AND (raw_text ILIKE $2 OR staff_number ILIKE $2)';
      countParams.push(`%${search}%`);
    }
    const countResult = await db.query(countQuery, countParams);

    requestLogger.info({ 
      status,
      count: result.rows.length,
      total: parseInt(countResult.rows[0].count)
    }, 'Admin unknown rosters listed');

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

// GET /api/admin/unknown-rosters/:id - Get single unknown roster details
router.get('/unknown-rosters/:id', adminAuth, async (req, res) => {
  const requestLogger = logger.createRequestLogger({ route: 'admin-unknown-detail' });
  
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT 
        ur.*,
        u.email, u.first_name, u.last_name, u.rank
      FROM unknown_rosters ur
      LEFT JOIN users u ON ur.user_id = u.id
      WHERE ur.id = $1::uuid`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Unknown roster not found' });
    }

    requestLogger.info({ unknownRosterId: id }, 'Admin unknown roster detail retrieved');

    res.json({ unknown_roster: result.rows[0] });

  } catch (error) {
    requestLogger.error({ error: error.message }, 'Failed to get unknown roster detail');
    res.status(500).json({ error: 'Failed to get unknown roster' });
  }
});

// PATCH /api/admin/unknown-rosters/:id - Update unknown roster status
router.patch('/unknown-rosters/:id', adminAuth, async (req, res) => {
  const requestLogger = logger.createRequestLogger({ route: 'admin-update-unknown' });
  
  try {
    const { id } = req.params;
    const { status, resolution_notes } = req.body;

    if (!['resolved', 'ignored', 'pending'].includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status. Must be: resolved, ignored, or pending' 
      });
    }

    // Get admin user email
    const userResult = await db.query(
      'SELECT email FROM users WHERE id = $1::uuid',
      [req.userId]
    );
    const resolvedBy = userResult.rows[0]?.email || 'admin';

    const result = await db.query(
      `UPDATE unknown_rosters 
       SET status = $1,
           resolved_at = CASE WHEN $1 != 'pending' THEN NOW() ELSE NULL END,
           resolved_by = CASE WHEN $1 != 'pending' THEN $2 ELSE NULL END,
           resolution_notes = $3
       WHERE id = $4::uuid
       RETURNING *`,
      [status, resolvedBy, resolution_notes, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Unknown roster not found' });
    }

    requestLogger.info({ 
      unknownRosterId: id,
      newStatus: status,
      resolvedBy 
    }, 'Admin updated unknown roster status');

    res.json({
      message: 'Unknown roster updated successfully',
      unknown_roster: result.rows[0]
    });

  } catch (error) {
    requestLogger.error({ error: error.message }, 'Failed to update unknown roster');
    res.status(500).json({ error: 'Failed to update unknown roster' });
  }
});

// DELETE /api/admin/unknown-rosters/:id - Delete unknown roster
router.delete('/unknown-rosters/:id', adminAuth, async (req, res) => {
  const requestLogger = logger.createRequestLogger({ route: 'admin-delete-unknown' });
  
  try {
    const { id } = req.params;

    const result = await db.query(
      'DELETE FROM unknown_rosters WHERE id = $1::uuid RETURNING id',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Unknown roster not found' });
    }

    requestLogger.info({ unknownRosterId: id }, 'Admin deleted unknown roster');

    res.json({ message: 'Unknown roster deleted successfully' });

  } catch (error) {
    requestLogger.error({ error: error.message }, 'Failed to delete unknown roster');
    res.status(500).json({ error: 'Failed to delete unknown roster' });
  }
});

module.exports = router;
