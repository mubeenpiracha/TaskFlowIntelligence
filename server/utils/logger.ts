/**
 * Structured logging utility for consistent logging across the application
 */
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Log levels
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

// Log entry interface
interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  service?: string;
  userId?: number;
  error?: string;
  metadata?: Record<string, any>;
}

class Logger {
  private logLevel: LogLevel;
  private logStream?: NodeJS.WritableStream;

  constructor() {
    this.logLevel = this.getLogLevel();
    this.setupFileLogging();
  }

  private getLogLevel(): LogLevel {
    const level = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
    return LogLevel[level as keyof typeof LogLevel] ?? LogLevel.INFO;
  }

  private setupFileLogging() {
    if (process.env.NODE_ENV === 'production') {
      const logsDir = join(process.cwd(), 'logs');
      if (!existsSync(logsDir)) {
        mkdirSync(logsDir, { recursive: true });
      }
      
      const logFile = join(logsDir, 'app.log');
      this.logStream = createWriteStream(logFile, { flags: 'a' });
    }
  }

  private formatLog(entry: LogEntry): string {
    return JSON.stringify(entry) + '\n';
  }

  private writeLog(level: LogLevel, message: string, options: {
    service?: string;
    userId?: number;
    error?: Error;
    metadata?: Record<string, any>;
  } = {}) {
    if (level > this.logLevel) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LogLevel[level],
      message,
      service: options.service,
      userId: options.userId,
      error: options.error?.stack || options.error?.message,
      metadata: options.metadata
    };

    const logString = this.formatLog(entry);

    // Console output
    if (level === LogLevel.ERROR) {
      console.error(logString.trim());
    } else if (level === LogLevel.WARN) {
      console.warn(logString.trim());
    } else {
      console.log(logString.trim());
    }

    // File output in production
    if (this.logStream) {
      this.logStream.write(logString);
    }
  }

  error(message: string, options?: {
    service?: string;
    userId?: number;
    error?: Error;
    metadata?: Record<string, any>;
  }) {
    this.writeLog(LogLevel.ERROR, message, options);
  }

  warn(message: string, options?: {
    service?: string;
    userId?: number;
    metadata?: Record<string, any>;
  }) {
    this.writeLog(LogLevel.WARN, message, options);
  }

  info(message: string, options?: {
    service?: string;
    userId?: number;
    metadata?: Record<string, any>;
  }) {
    this.writeLog(LogLevel.INFO, message, options);
  }

  debug(message: string, options?: {
    service?: string;
    userId?: number;
    metadata?: Record<string, any>;
  }) {
    this.writeLog(LogLevel.DEBUG, message, options);
  }

  // Service-specific loggers
  service(serviceName: string) {
    return {
      error: (message: string, options?: Omit<Parameters<typeof this.error>[1], 'service'>) => 
        this.error(message, { ...options, service: serviceName }),
      warn: (message: string, options?: Omit<Parameters<typeof this.warn>[1], 'service'>) => 
        this.warn(message, { ...options, service: serviceName }),
      info: (message: string, options?: Omit<Parameters<typeof this.info>[1], 'service'>) => 
        this.info(message, { ...options, service: serviceName }),
      debug: (message: string, options?: Omit<Parameters<typeof this.debug>[1], 'service'>) => 
        this.debug(message, { ...options, service: serviceName })
    };
  }
}

export const logger = new Logger();
export default logger;