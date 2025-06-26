/**
 * Centralized application configuration
 * Consolidates all configuration values and provides type safety
 */

export interface AppConfig {
  scheduler: {
    interval: number;
    maxRetries: number;
  };
  websocket: {
    maxConnectionsPerUser: number;
    heartbeatInterval: number;
    pingInterval: number;
  };
  rateLimit: {
    general: {
      windowMs: number;
      max: number;
    };
    webhook: {
      windowMs: number;
      max: number;
    };
    auth: {
      windowMs: number;
      max: number;
    };
  };
  database: {
    cleanupInterval: number;
    processedMessageRetentionDays: number;
  };
  security: {
    sessionMaxAge: number;
    passwordHashIterations: number;
    tokenExpirationHours: number;
  };
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export const appConfig: AppConfig = {
  scheduler: {
    interval: getEnvNumber('SCHEDULER_INTERVAL_MS', 30000), // 30 seconds
    maxRetries: getEnvNumber('SCHEDULER_MAX_RETRIES', 3),
  },
  websocket: {
    maxConnectionsPerUser: getEnvNumber('MAX_WS_CONNECTIONS_PER_USER', 5),
    heartbeatInterval: getEnvNumber('WS_HEARTBEAT_INTERVAL_MS', 30000), // 30 seconds
    pingInterval: getEnvNumber('WS_PING_INTERVAL_MS', 25000), // 25 seconds
  },
  rateLimit: {
    general: {
      windowMs: getEnvNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000), // 15 minutes
      max: getEnvNumber('RATE_LIMIT_MAX_REQUESTS', 100),
    },
    webhook: {
      windowMs: getEnvNumber('WEBHOOK_RATE_LIMIT_WINDOW_MS', 60 * 1000), // 1 minute
      max: getEnvNumber('WEBHOOK_RATE_LIMIT_MAX_REQUESTS', 60),
    },
    auth: {
      windowMs: getEnvNumber('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000), // 15 minutes
      max: getEnvNumber('AUTH_RATE_LIMIT_MAX_REQUESTS', 5),
    },
  },
  database: {
    cleanupInterval: getEnvNumber('DB_CLEANUP_INTERVAL_HOURS', 24), // 24 hours
    processedMessageRetentionDays: getEnvNumber('PROCESSED_MESSAGE_RETENTION_DAYS', 30),
  },
  security: {
    sessionMaxAge: getEnvNumber('SESSION_MAX_AGE_HOURS', 24) * 60 * 60 * 1000, // 24 hours in ms
    passwordHashIterations: getEnvNumber('PASSWORD_HASH_ITERATIONS', 10000),
    tokenExpirationHours: getEnvNumber('TOKEN_EXPIRATION_HOURS', 1),
  },
};

// Validation function to ensure required configuration is present
export function validateAppConfig(): void {
  const requiredEnvVars = [
    'DATABASE_URL',
    'SESSION_SECRET',
  ];

  const missing = requiredEnvVars.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // Validate configuration values
  if (appConfig.scheduler.interval < 1000) {
    console.warn('[CONFIG] Scheduler interval is less than 1 second, this may cause performance issues');
  }

  if (appConfig.websocket.maxConnectionsPerUser > 50) {
    console.warn('[CONFIG] Very high WebSocket connection limit may cause memory issues');
  }

  console.log('[CONFIG] Application configuration validated successfully');
}

export default appConfig;