const pino = require('pino');

// Determine if we should use pretty printing (development only)
const isDevelopment = process.env.NODE_ENV !== 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: isDevelopment 
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
          singleLine: false
        }
      }
    : undefined, // In production, output raw JSON
});

// Helper to create child loggers with context
logger.createRequestLogger = (context) => {
  const requestId = Math.random().toString(36).substring(2, 8).toUpperCase();
  return logger.child({ requestId, ...context });
};

// Helper to check if service debugging is enabled
logger.isServiceDebugEnabled = () => {
  return process.env.LOG_SERVICE_DEBUG === 'true';
};

module.exports = logger;