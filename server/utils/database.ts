/**
 * Database transaction utilities and helpers
 * Provides transaction support for complex operations
 */
import { db } from '../db';
import { logger } from './logger';

const dbLogger = logger.service('Database');

export type TransactionCallback<T> = (tx: typeof db) => Promise<T>;

/**
 * Execute a database operation within a transaction
 * Automatically handles rollback on errors
 */
export async function withTransaction<T>(
  operation: TransactionCallback<T>,
  operationName?: string
): Promise<T> {
  const opName = operationName || 'unknown';
  
  try {
    dbLogger.debug(`Starting transaction: ${opName}`);
    
    const result = await db.transaction(async (tx) => {
      return await operation(tx);
    });
    
    dbLogger.debug(`Transaction completed successfully: ${opName}`);
    return result;
  } catch (error) {
    dbLogger.error(`Transaction failed: ${opName}`, {
      error: error as Error,
      metadata: { operationName: opName }
    });
    throw error;
  }
}

/**
 * Retry a database operation with exponential backoff
 * Useful for handling temporary connection issues
 */
export async function retryDatabaseOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
  operationName?: string
): Promise<T> {
  const opName = operationName || 'unknown';
  let lastError: Error;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      if (attempt > 1) {
        dbLogger.info(`Database operation succeeded on retry: ${opName}`, {
          metadata: { attempt, maxRetries }
        });
      }
      return result;
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        dbLogger.error(`Database operation failed after all retries: ${opName}`, {
          error: lastError,
          metadata: { attempts: maxRetries }
        });
        break;
      }
      
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      dbLogger.warn(`Database operation failed, retrying: ${opName}`, {
        error: lastError,
        metadata: { attempt, maxRetries, nextRetryInMs: delay }
      });
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError!;
}

/**
 * Health check for database connectivity
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    // Simple query to test connectivity
    await db.execute(`SELECT 1 as health_check`);
    return true;
  } catch (error) {
    dbLogger.error('Database health check failed', {
      error: error as Error
    });
    return false;
  }
}

/**
 * Get database connection pool statistics (if available)
 */
export async function getDatabaseStats(): Promise<{
  healthy: boolean;
  connectionCount?: number;
  error?: string;
}> {
  try {
    const healthy = await checkDatabaseHealth();
    
    if (!healthy) {
      return { healthy: false, error: 'Health check failed' };
    }
    
    // Try to get connection count from pg_stat_activity
    try {
      const result = await db.execute(`
        SELECT COUNT(*) as active_connections 
        FROM pg_stat_activity 
        WHERE state = 'active'
      `);
      
      return {
        healthy: true,
        connectionCount: parseInt(result.rows[0]?.active_connections || '0')
      };
    } catch {
      // If we can't get stats, that's okay
      return { healthy: true };
    }
  } catch (error) {
    return {
      healthy: false,
      error: (error as Error).message
    };
  }
}