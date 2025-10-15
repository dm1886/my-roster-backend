// src/index.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const db = require('./config/db'); // ADD THIS

const app = express();

// Security & Parsing Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logger (MOVE UP BEFORE ROUTES)
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Health Check (no auth required)
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV 
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    name: 'Roster API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      health: '/health',
      auth: '/api/auth/*',
      icrew: '/api/icrew/*',
      monthly: '/api/icrew/monthly/*'
    }
  });
});

// API Routes (AFTER LOGGER)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/icrew', require('./routes/icrew'));
app.use('/api/icrew/monthly', require('./routes/icrewMonthly'));
app.use('/api/icrew/weekly', require('./routes/icrewWeekly'));

// 404 Handler
app.use((req, res) => {
  res.status(404).json({ 
    error: 'Not Found',
    path: req.originalUrl,
    message: 'The requested endpoint does not exist'
  });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log('='.repeat(50));
  console.log(`✓ Server running on http://localhost:${PORT}`);
  console.log(`✓ Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Test database connection
  try {
    await db.query('SELECT NOW()');
    console.log(`✓ Database: Connected`);
  } catch (error) {
    console.log(`✗ Database: Not Connected - ${error.message}`);
  }
  
  console.log('='.repeat(50));
});