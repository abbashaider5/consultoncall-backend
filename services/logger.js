/**
 * Simple Logger Module
 * Provides consistent logging interface for the backend
 */

const logger = {
  /**
   * Log info message
   */
  info: (...args) => {
    console.log('ℹ️  INFO:', ...args);
  },

  /**
   * Log error message
   */
  error: (...args) => {
    console.error('❌ ERROR:', ...args);
  },

  /**
   * Log warning message
   */
  warn: (...args) => {
    console.warn('⚠️  WARN:', ...args);
  },

  /**
   * Log debug message (only in development)
   */
  debug: (...args) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log('🐛 DEBUG:', ...args);
    }
  }
};

module.exports = logger;
