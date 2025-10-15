// src/index.js
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const db = require('./config/db');
const logger = require('./utils/logger');

const app = express();

// Security & Parsing Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// HTTP Request Logger with Pino
app.use((req, res, next) => {
  const start = Date.now();
  
  // Log request
  const requestLogger = logger.createRequestLogger({
    method: req.method,
    url: req.originalUrl,
    ip: req.ip
  });

  requestLogger.info('Incoming request');

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - start;
    requestLogger.info({
      statusCode: res.statusCode,
      duration: `${duration}ms`
    }, 'Request completed');
  });

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
      monthly: '/api/icrew/monthly/*',
      weekly: '/api/icrew/weekly/*'
    }
  });
});

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/icrew', require('./routes/icrew'));
app.use('/api/icrew/monthly', require('./routes/icrewMonthly'));
app.use('/api/icrew/weekly', require('./routes/icrewWeekly'));

// 404 Handler
app.use((req, res) => {
  logger.warn({ path: req.originalUrl }, 'Route not found');
  res.status(404).json({ 
    error: 'Not Found',
    path: req.originalUrl,
    message: 'The requested endpoint does not exist'
  });
});

// Error Handler
app.use((err, req, res, next) => {
  logger.error({ error: err.message, stack: err.stack }, 'Unhandled error');
  res.status(err.status || 500).json({ 
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  logger.info({
    port: PORT,
    env: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    serviceDebug: process.env.LOG_SERVICE_DEBUG === 'true'
  }, 'Server started successfully');
  
  // Test database connection
  try {
    await db.query('SELECT NOW()');
    logger.info('Database connection established');
  } catch (error) {
    logger.error({ error: error.message }, 'Database connection failed');
  }
});