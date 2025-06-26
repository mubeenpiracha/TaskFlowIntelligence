/**
 * Service to manage processed Slack messages
 * Replaces file-based tracking with database storage to fix memory leak
 */
import { storage } from "../storage";
import { logger } from "../utils/logger";
import { appConfig } from "../appConfig";
import type { InsertProcessedMessage } from "@shared/schema";

const serviceLogger = logger.service('ProcessedMessages');

/**
 * Check if a Slack message has already been processed
 */
export async function isMessageAlreadyProcessed(
  slackMessageId: string, 
  slackChannelId: string
): Promise<boolean> {
  try {
    return await storage.isMessageProcessed(slackMessageId, slackChannelId);
  } catch (error) {
    serviceLogger.error('Failed to check if message is processed', {
      error: error as Error,
      metadata: { slackMessageId, slackChannelId }
    });
    // Return false to allow processing in case of database error
    return false;
  }
}

/**
 * Mark a Slack message as processed with the result
 */
export async function markMessageAsProcessed(
  slackMessageId: string,
  slackChannelId: string,
  workspaceId: number,
  userId?: number,
  result: 'task_created' | 'no_task_detected' | 'user_declined' | 'error' = 'no_task_detected'
): Promise<void> {
  try {
    const processedMessage: InsertProcessedMessage = {
      slackMessageId,
      slackChannelId,
      workspaceId,
      userId: userId ?? null,
      processingResult: result
    };

    await storage.markMessageProcessed(processedMessage);
    
    serviceLogger.info('Message marked as processed', {
      metadata: { slackMessageId, slackChannelId, result, workspaceId, userId }
    });
  } catch (error) {
    serviceLogger.error('Failed to mark message as processed', {
      error: error as Error,
      metadata: { slackMessageId, slackChannelId, result, workspaceId, userId }
    });
    // Don't throw error - this is not critical for application flow
  }
}

/**
 * Cleanup old processed messages based on retention policy
 * Should be called periodically to prevent database bloat
 */
export async function cleanupOldProcessedMessages(): Promise<number> {
  try {
    const retentionDays = appConfig.database.processedMessageRetentionDays;
    const deletedCount = await storage.cleanupOldProcessedMessages(retentionDays);
    
    if (deletedCount > 0) {
      serviceLogger.info(`Cleaned up ${deletedCount} old processed messages`, {
        metadata: { retentionDays, deletedCount }
      });
    }
    
    return deletedCount;
  } catch (error) {
    serviceLogger.error('Failed to cleanup old processed messages', {
      error: error as Error
    });
    return 0;
  }
}

/**
 * Start the cleanup service that runs periodically
 */
export function startProcessedMessagesCleanupService(): void {
  const intervalHours = appConfig.database.cleanupInterval;
  const intervalMs = intervalHours * 60 * 60 * 1000;
  
  serviceLogger.info(`Starting processed messages cleanup service`, {
    metadata: { intervalHours, retentionDays: appConfig.database.processedMessageRetentionDays }
  });
  
  // Run cleanup immediately on startup
  cleanupOldProcessedMessages();
  
  // Then run cleanup every N hours
  setInterval(async () => {
    await cleanupOldProcessedMessages();
  }, intervalMs);
}