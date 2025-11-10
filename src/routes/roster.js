// src/routes/roster.js
// Roster synchronization API endpoints
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const authenticateToken = require('../middleware/auth');
const logger = require('../utils/logger');

// ==================== UPLOAD ROSTER (iOS → Server) ====================
router.post('/upload', authenticateToken, async (req, res) => {
  const requestLogger = logger.createRequestLogger({ route: 'roster-upload' });
  const client = await db.pool.connect();
  
  try {
    const {
      crew_id,
      period_start,
      period_end,
      version_number,
      source_file_name,
      source_file_size,
      json_data,
      name,
      flight_time,
      generated_at,
      app_version,
      device_model,
      ios_version
    } = req.body;
    
    // Validate required fields
    if (!crew_id || !period_start || !period_end || !json_data) {
      return res.status(400).json({ 
        error: 'Missing required fields: crew_id, period_start, period_end, json_data' 
      });
    }
    
    requestLogger.info({ 
      userId: req.user.sub, 
      crewId: crew_id, 
      period: `${period_start}-${period_end}`,
      version: version_number 
    }, '📤 Starting roster upload');
    
    await client.query('BEGIN');
    
    // 1. Find or create roster period
    let periodResult = await client.query(
      `INSERT INTO roster_periods (user_id, crew_id, period_start, period_end)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, crew_id, period_start, period_end)
       DO UPDATE SET last_updated_at = NOW()
       RETURNING id`,
      [req.user.sub, crew_id, period_start, period_end]
    );
    
    const period_id = periodResult.rows[0].id;
    
    // 2. Insert roster version
    const versionResult = await client.query(
      `INSERT INTO roster_versions (
        period_id, version_number, source_file_name, source_file_size,
        json_data, name, flight_time, generated_at,
        app_version, device_model, ios_version
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (period_id, version_number)
      DO UPDATE SET 
        json_data = EXCLUDED.json_data,
        parsed_at = NOW()
      RETURNING id`,
      [
        period_id, version_number, source_file_name, source_file_size,
        json_data, name, flight_time, generated_at,
        app_version, device_model, ios_version
      ]
    );
    
    const version_id = versionResult.rows[0].id;
    
    // 3. Parse and insert roster days
    const days = json_data.roster || json_data.days || [];
    
    requestLogger.info({ daysCount: days.length }, 'Processing roster days');
    
    let daysInserted = 0;
    let sectorsInserted = 0;
    
    for (const day of days) {
      // Parse date (stored in UTC)
      const dayDate = new Date(day.isoDate || day.date);

      // Handle both 'rawText' and 'raw' field names
      const rawText = day.rawText || day.raw || '';

      // Handle both 'duties' and 'parsed' field names
      const parsedDuties = day.parsed || day.duties || [];

      // Check if there's a previous version for this date
      const previousDayResult = await client.query(
        `SELECT raw_text, parsed_data 
         FROM roster_days 
         WHERE period_id = $1 AND date = $2 AND is_active_for_date = true
         LIMIT 1`,
        [period_id, dayDate]
      );

      // Determine if content actually changed
      let contentChanged = true;
      if (previousDayResult.rows.length > 0) {
        const prevRawText = previousDayResult.rows[0].raw_text;
        const prevParsedData = previousDayResult.rows[0].parsed_data;
        
        // Compare raw text and parsed data
        contentChanged = (prevRawText !== rawText) || 
                        (JSON.stringify(prevParsedData) !== JSON.stringify(parsedDuties));
      }

      // Only insert new version if content changed
      if (contentChanged) {
        // Insert roster day
        const dayResult = await client.query(
          `INSERT INTO roster_days (
            period_id, source_version_id, date, day_number, weekday,
            iso_date, raw_text, parsed_data, is_active_for_date
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (period_id, date, source_version_id)
          DO UPDATE SET 
            raw_text = EXCLUDED.raw_text,
            parsed_data = EXCLUDED.parsed_data
          RETURNING id`,
          [
            period_id, version_id, dayDate, day.dayNumber || day.day_number, day.weekday,
            day.isoDate || day.iso_date, rawText, JSON.stringify(parsedDuties),
            true
          ]
        );

        const roster_day_id = dayResult.rows[0].id;

        // Deactivate previous versions for this date
        await client.query(
          `UPDATE roster_days 
           SET is_active_for_date = false 
           WHERE period_id = $1 
             AND date = $2 
             AND id != $3`,
          [period_id, dayDate, roster_day_id]
        );

        // Insert duty assignments (iterate over parsed array)
        for (let i = 0; i < parsedDuties.length; i++) {
          const duty = parsedDuties[i];
          
          // Extract duty fields with proper mapping
          const dutyKind = duty.dutyKind || duty.duty_kind || 'unknown';
          const dutyType = duty.dutyType || duty.duty_type || null;
          const ruleId = duty.ruleId || duty.rule_id || 'unknown';
          const checkIn = duty.checkIn || duty.check_in || null;
          const checkInStation = duty.checkInStation || duty.check_in_station || null;
          const checkInDate = duty.checkInDate || duty.check_in_date ? new Date(duty.checkInDate || duty.check_in_date) : null;
          const checkOut = duty.checkOut || duty.check_out || null;
          const checkOutStation = duty.checkOutStation || duty.check_out_station || null;
          const checkOutDate = duty.checkOutDate || duty.check_out_date ? new Date(duty.checkOutDate || duty.check_out_date) : null;
          const isInstructorDuty = duty.isInstructorDuty || duty.is_instructor_duty || null;
          const learningTitle = duty.learningTitle || duty.learning_title || null;
          const notes = JSON.stringify(duty.notes || []);

          const dutyResult = await client.query(
            `INSERT INTO duty_assignments (
              roster_day_id, sequence_order, duty_kind, duty_type, rule_id,
              check_in, check_in_station, check_in_date,
              check_out, check_out_station, check_out_date,
              is_instructor_duty, learning_title, notes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id`,
            [
              roster_day_id, i + 1, dutyKind, dutyType, ruleId,
              checkIn, checkInStation, checkInDate,
              checkOut, checkOutStation, checkOutDate,
              isInstructorDuty, learningTitle, notes
            ]
          );

          const duty_assignment_id = dutyResult.rows[0].id;

          // Insert sectors
          const sectors = duty.sectors || [];
          requestLogger.info({ duty: dutyKind, sectorCount: sectors.length }, `Processing ${sectors.length} sectors for duty`);
          
          for (const sector of sectors) {
            // ✅ FIXED: Support both depICAO/arrICAO (from iOS) and depIATA/arrIATA (alternative format)
            const depIATA = sector.depIATA || sector.dep_iata || sector.depIata || sector.depICAO || sector.depIcao || '';
            const arrIATA = sector.arrIATA || sector.arr_iata || sector.arrIata || sector.arrICAO || sector.arrIcao || '';
            const flightNumber = sector.flightNumber || sector.flight_number || '';
            const depTime = sector.depTime || sector.dep_time || null;
            const arrTime = sector.arrTime || sector.arr_time || null;
            const aircraft = sector.aircraft || null;
            const depTimeDt = sector.depTimeDt || sector.dep_time_dt ? new Date(sector.depTimeDt || sector.dep_time_dt) : null;
            const arrTimeDt = sector.arrTimeDt || sector.arr_time_dt ? new Date(sector.arrTimeDt || sector.arr_time_dt) : null;
            const kindTrainingDuty = sector.kindTrainingDuty || sector.kind_training_duty || 'none';
            const cockpitCrew = JSON.stringify(sector.cockpitCrew || sector.cockpit_crew || []);
            const cabinCrew = JSON.stringify(sector.cabinCrew || sector.cabin_crew || []);
            const depTimeIsLocal = sector.depTimeIsLocal || sector.dep_time_is_local || false;
            const arrTimeIsLocal = sector.arrTimeIsLocal || sector.arr_time_is_local || false;

            // Validate IATA codes (must be 3 characters)
            if (!depIATA || depIATA.length < 3 || !arrIATA || arrIATA.length < 3) {
              requestLogger.warn({ sector, depIATA, arrIATA }, 'Skipping sector with invalid IATA codes');
              continue;
            }

            await client.query(
              `INSERT INTO sectors (
                duty_assignment_id, flight_number, dep_iata, arr_iata,
                dep_time, arr_time, aircraft, dep_time_dt, arr_time_dt,
                kind_training_duty, cockpit_crew, cabin_crew,
                dep_time_is_local, arr_time_is_local
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
              [
                duty_assignment_id, flightNumber, depIATA.slice(0, 3).toUpperCase(), arrIATA.slice(0, 3).toUpperCase(),
                depTime, arrTime, aircraft, depTimeDt, arrTimeDt,
                kindTrainingDuty, cockpitCrew, cabinCrew,
                depTimeIsLocal, arrTimeIsLocal
              ]
            );
            
            sectorsInserted++;
            requestLogger.info({ flightNumber, depIATA, arrIATA }, `✅ Sector inserted: ${flightNumber} ${depIATA}->${arrIATA}`);
          }
        }

        daysInserted++;
      } else {
        requestLogger.info({ date: dayDate }, 'Skipping day - no changes detected');
      }
    }
    
    // 4. Record sync metadata
    await client.query(
      `INSERT INTO roster_sync_metadata (
        user_id, period_id, sync_direction, days_synced, sync_status
      )
      VALUES ($1, $2, 'upload', $3, 'success')`,
      [req.user.sub, period_id, daysInserted]
    );
    
    await client.query('COMMIT');
    
    requestLogger.info({
      userId: req.user.sub,
      periodId: period_id,
      versionId: version_id,
      versionNumber: version_number,
      daysInserted,
      sectorsInserted
    }, `✅ Roster uploaded successfully with ${sectorsInserted} sectors`);
    
    res.status(201).json({
      message: 'Roster uploaded successfully',
      period_id,
      version_id,
      days_inserted: daysInserted,
      sectors_inserted: sectorsInserted
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    requestLogger.error({ error: error.message, stack: error.stack }, '❌ Roster upload error');
    res.status(500).json({ error: 'Failed to upload roster', details: error.message });
  } finally {
    client.release();
  }
});

// ==================== GET ROSTER PERIODS ====================
// ==================== GET ROSTER PERIODS (LATEST PER MONTH) ====================
router.get('/periods', authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `WITH ranked_periods AS (
        SELECT 
          rp.*,
          COUNT(DISTINCT rd.id) as total_days,
          MAX(rv.parsed_at) as latest_version_at,
          ROW_NUMBER() OVER (
            PARTITION BY DATE_TRUNC('month', rp.period_start::date), rp.crew_id
            ORDER BY rp.last_updated_at DESC
          ) as rn
        FROM roster_periods rp
        LEFT JOIN roster_versions rv ON rv.period_id = rp.id
        LEFT JOIN roster_days rd ON rd.period_id = rp.id AND rd.is_active_for_date = true
        WHERE rp.user_id = $1
        GROUP BY rp.id
      )
      SELECT * FROM ranked_periods WHERE rn = 1
      ORDER BY period_start DESC`,
      [req.user.sub]
    );
    
    res.json({ periods: result.rows });
    
  } catch (error) {
    logger.error({ error: error.message }, 'Get periods error');
    res.status(500).json({ error: 'Failed to fetch periods' });
  }
});

// ==================== GET SPECIFIC PERIOD ====================
router.get('/periods/:period_id', authenticateToken, async (req, res) => {
  try {
    const { period_id } = req.params;
    
    const periodResult = await db.query(
      `SELECT * FROM roster_periods 
       WHERE id = $1 AND user_id = $2`,
      [period_id, req.user.sub]
    );
    
    if (periodResult.rows.length === 0) {
      return res.status(404).json({ error: 'Period not found' });
    }
    
    const versionsResult = await db.query(
      `SELECT 
        id, version_number, source_file_name, source_file_size,
        parsed_at, name, flight_time, generated_at
       FROM roster_versions
       WHERE period_id = $1
       ORDER BY version_number DESC`,
      [period_id]
    );
    
    const changesResult = await db.query(
      `SELECT 
        date,
        COUNT(DISTINCT source_version_id) as version_count
       FROM roster_days
       WHERE period_id = $1
       GROUP BY date
       HAVING COUNT(DISTINCT source_version_id) > 1
       ORDER BY date`,
      [period_id]
    );
    
    res.json({
      period: periodResult.rows[0],
      versions: versionsResult.rows,
      changes: changesResult.rows
    });
    
  } catch (error) {
    logger.error({ error: error.message }, 'Get period detail error');
    res.status(500).json({ error: 'Failed to fetch period details' });
  }
});

// ==================== GET ROSTER FOR DATE RANGE ====================
router.get('/days', authenticateToken, async (req, res) => {
  try {
    const { period_id, start_date, end_date } = req.query;
    
    if (!period_id) {
      return res.status(400).json({ error: 'period_id is required' });
    }
    
    const periodCheck = await db.query(
      'SELECT id FROM roster_periods WHERE id = $1 AND user_id = $2',
      [period_id, req.user.sub]
    );
    
    if (periodCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Period not found' });
    }
    
    let query = `
      SELECT 
        rd.id, rd.date, rd.day_number, rd.weekday, rd.iso_date,
        rd.raw_text, rd.parsed_data, rd.is_active_for_date, rd.updated_at,
        rv.version_number, rv.source_file_name,
        (
          SELECT COUNT(DISTINCT rd2.id) > 1
          FROM roster_days rd2
          WHERE rd2.period_id = rd.period_id 
          AND rd2.date = rd.date
        ) as has_changes
      FROM roster_days rd
      JOIN roster_versions rv ON rv.id = rd.source_version_id
      WHERE rd.period_id = $1 AND rd.is_active_for_date = true
    `;
    
    const params = [period_id];
    let paramCount = 1;
    
    if (start_date) {
      paramCount++;
      query += ` AND rd.date >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND rd.date <= $${paramCount}`;
      params.push(end_date);
    }
    
    query += ' ORDER BY rd.date ASC';
    
    const result = await db.query(query, params);
    
    res.json({ days: result.rows });
    
  } catch (error) {
    logger.error({ error: error.message }, 'Get roster days error');
    res.status(500).json({ error: 'Failed to fetch roster days' });
  }
});

// ==================== GET CHANGE HISTORY FOR SPECIFIC DATE ====================
router.get('/days/:period_id/:date/history', authenticateToken, async (req, res) => {
  try {
    const { period_id, date } = req.params;
    
    const periodCheck = await db.query(
      'SELECT id FROM roster_periods WHERE id = $1 AND user_id = $2',
      [period_id, req.user.sub]
    );
    
    if (periodCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Period not found' });
    }
    
    const result = await db.query(
      `SELECT 
        rd.*,
        rv.version_number,
        rv.source_file_name,
        rv.parsed_at as version_parsed_at
       FROM roster_days rd
       JOIN roster_versions rv ON rv.id = rd.source_version_id
       WHERE rd.period_id = $1 AND rd.date = $2
       ORDER BY rv.version_number DESC`,
      [period_id, date]
    );
    
    res.json({ versions: result.rows });
    
  } catch (error) {
    logger.error({ error: error.message }, 'Get date history error');
    res.status(500).json({ error: 'Failed to fetch date history' });
  }
});

// ==================== DELETE PERIOD ====================
router.delete('/periods/:period_id', authenticateToken, async (req, res) => {
  const requestLogger = logger.createRequestLogger({ route: 'delete-period' });
  
  try {
    const { period_id } = req.params;
    
    const result = await db.query(
      'DELETE FROM roster_periods WHERE id = $1 AND user_id = $2 RETURNING crew_id, period_start, period_end',
      [period_id, req.user.sub]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Period not found' });
    }
    
    requestLogger.info({
      userId: req.user.sub,
      periodId: period_id
    }, 'Period deleted');
    
    res.json({ 
      message: 'Period deleted successfully',
      deleted: result.rows[0]
    });
    
  } catch (error) {
    requestLogger.error({ error: error.message }, 'Delete period error');
    res.status(500).json({ error: 'Failed to delete period' });
  }
});

// ==================== GET SYNC HISTORY ====================
router.get('/sync-history', authenticateToken, async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    
    const result = await db.query(
      `SELECT 
        rsm.*,
        rp.period_start,
        rp.period_end
       FROM roster_sync_metadata rsm
       LEFT JOIN roster_periods rp ON rp.id = rsm.period_id
       WHERE rsm.user_id = $1
       ORDER BY rsm.last_sync_at DESC
       LIMIT $2`,
      [req.user.sub, limit]
    );
    
    res.json({ sync_history: result.rows });
    
  } catch (error) {
    logger.error({ error: error.message }, 'Get sync history error');
    res.status(500).json({ error: 'Failed to fetch sync history' });
  }
});

// ==================== GET DUTIES FOR A SPECIFIC DAY ====================
router.get('/days/:day_id/duties', authenticateToken, async (req, res) => {
  const requestLogger = logger.createRequestLogger({ route: 'get-day-duties' });

  try {
    const { day_id } = req.params;

    const dayCheck = await db.query(
      `SELECT rd.id, rd.period_id
       FROM roster_days rd
       JOIN roster_periods rp ON rp.id = rd.period_id
       WHERE rd.id = $1 AND rp.user_id = $2 AND rd.is_active_for_date = true`,
      [day_id, req.user.sub]
    );

    if (dayCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Day not found or not active' });
    }

    const dutiesResult = await db.query(
      `SELECT 
         da.*,
         COALESCE(
           JSON_AGG(
             JSON_BUILD_OBJECT(
               'id', s.id,
               'flight_number', s.flight_number,
               'dep_iata', s.dep_iata,
               'arr_iata', s.arr_iata,
               'dep_time', s.dep_time,
               'arr_time', s.arr_time,
               'aircraft', s.aircraft,
               'dep_time_dt', s.dep_time_dt,
               'arr_time_dt', s.arr_time_dt,
               'kind_training_duty', s.kind_training_duty,
               'cockpit_crew', s.cockpit_crew,
               'cabin_crew', s.cabin_crew,
               'dep_time_is_local', s.dep_time_is_local,
               'arr_time_is_local', s.arr_time_is_local
             ) ORDER BY s.id
           ) FILTER (WHERE s.id IS NOT NULL),
           '[]'
         ) AS sectors
       FROM duty_assignments da
       LEFT JOIN sectors s ON s.duty_assignment_id = da.id
       WHERE da.roster_day_id = $1
       GROUP BY da.id
       ORDER BY da.sequence_order`,
      [day_id]
    );

    requestLogger.info({ dayId: day_id, count: dutiesResult.rows.length }, 'Duties retrieved');

    res.json({ duties: dutiesResult.rows });

  } catch (error) {
    logger.error({ error: error.message }, 'Get day duties error');
    res.status(500).json({ error: 'Failed to fetch duties' });
  }
});

module.exports = router;
