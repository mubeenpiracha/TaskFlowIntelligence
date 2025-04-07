import { WebClient } from '@slack/web-api';
import { detectTasks, sendTaskDetectionDM } from './slack';
import { storage } from '../storage';
import { getChannelPreferences } from './channelPreferences';
import { User } from '@shared/schema';
import fs from 'fs';
import path from 'path';

// Interval between monitoring cycles (in milliseconds)
// Changed from 1 minute to 10 minutes to avoid frequent processing
const MONITORING_INTERVAL = 600000; // 10 minutes

// Map to track the last checked timestamp for each channel
const lastCheckedTimestamps: Map<string, string> = new Map();

// Set to keep track of messages we've already processed 
// This is needed because the database check alone might not be enough
// if the user doesn't accept the task
const processedMessages: Set<string> = new Set();

// Flag to track if monitoring is active
let isMonitoringActive = false;
let monitoringInterval: NodeJS.Timeout | null = null;

// File path for persisting processed message IDs
const PROCESSED_MESSAGES_FILE = path.join(__dirname, '../../processed_messages.json');

/**
 * Loads processed message IDs from file if it exists
 * @returns Array of message IDs
 */
function loadProcessedMessagesFromFile(): string[] {
  try {
    if (fs.existsSync(PROCESSED_MESSAGES_FILE)) {
      const fileContent = fs.readFileSync(PROCESSED_MESSAGES_FILE, 'utf8');
      const data = JSON.parse(fileContent);
      if (Array.isArray(data)) {
        console.log(`Loaded ${data.length} processed message IDs from file`);
        return data;
      }
    }
  } catch (error) {
    console.error('Error loading processed messages from file:', error);
  }
  return [];
}

/**
 * Saves the current set of processed message IDs to a file
 */
function saveProcessedMessagesToFile(): void {
  try {
    const messageArray = Array.from(processedMessages);
    fs.writeFileSync(PROCESSED_MESSAGES_FILE, JSON.stringify(messageArray), 'utf8');
    console.log(`Saved ${messageArray.length} processed message IDs to file`);
  } catch (error) {
    console.error('Error saving processed messages to file:', error);
  }
}

/**
 * Preloads already processed message IDs from both file and database
 * This is used to avoid re-processing messages on restart
 */
async function preloadProcessedMessages(): Promise<void> {
  try {
    console.log('Preloading processed message IDs...');
    
    // First, load from file (faster and more reliable)
    const fileMessages = loadProcessedMessagesFromFile();
    fileMessages.forEach(messageId => processedMessages.add(messageId));
    
    // Then, get additional IDs from database as backup
    const allUsers = await storage.getAllUsers();
    
    // Create an array of promises to fetch tasks for each user
    const taskPromises = allUsers.map(user => storage.getTasksByUser(user.id));
    
    // Wait for all promises to settle
    const results = await Promise.allSettled(taskPromises);
    
    // Extract tasks from successful results
    const allTasks = results
      .filter((result): result is PromiseFulfilledResult<any[]> => result.status === 'fulfilled')
      .flatMap(result => result.value)
      .filter(task => task.slackMessageId); // Only keep tasks with Slack message IDs
    
    // Add all message IDs to the processed set
    let newIdsCount = 0;
    allTasks.forEach(task => {
      if (task.slackMessageId && !processedMessages.has(task.slackMessageId)) {
        processedMessages.add(task.slackMessageId);
        newIdsCount++;
      }
    });
    
    console.log(`Preloaded ${processedMessages.size} processed message IDs (${newIdsCount} from database)`);
    
    // Save the combined set back to file
    if (newIdsCount > 0) {
      saveProcessedMessagesToFile();
    }
  } catch (error) {
    console.error('Error preloading processed message IDs:', error);
  }
}

/**
 * Starts the background monitoring service for Slack messages
 * Preloads processed messages and sets up interval for periodic checks
 * @returns A cleanup function to stop monitoring
 */
export function startSlackMonitoring(): () => void {
  if (isMonitoringActive) {
    console.log('Slack monitoring is already active, not starting a new instance');
    return () => stopSlackMonitoring();
  }
  
  console.log('Starting Slack monitoring service');
  isMonitoringActive = true;
  
  // Preload processed messages before starting
  void preloadProcessedMessages().then(() => {
    // Run initial check after preloading
    void checkForNewTasks();
    
    // Set up recurring monitoring
    monitoringInterval = setInterval(async () => {
      void checkForNewTasks();
    }, MONITORING_INTERVAL);
  });
  
  // Return a cleanup function
  return () => stopSlackMonitoring();
}

/**
 * Stops the Slack monitoring service
 */
function stopSlackMonitoring() {
  console.log('Stopping Slack monitoring service');
  isMonitoringActive = false;
  
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

/**
 * Checks for new tasks across all monitored users
 * This creates a checkpoint timestamp for each channel, so we only process new messages
 */
async function checkForNewTasks() {
  try {
    console.log('Running Slack message check for all users...');
    
    // Get all users with Slack integration configured
    const users = await getAllSlackUsers();
    console.log(`Found ${users.length} users with Slack integration`);
    
    // Process each user in parallel
    await Promise.allSettled(users.map(async (user) => {
      try {
        await checkUserTasks(user.id, user.slackUserId!, user.slackAccessToken);
      } catch (error) {
        console.error(`Error checking tasks for user ${user.id}:`, error);
      }
    }));
    
    console.log('Completed Slack message check cycle');
  } catch (error) {
    console.error('Error in checkForNewTasks:', error);
  }
}

/**
 * Gets all users who have Slack integration set up
 * @returns Array of users with their Slack info
 */
async function getAllSlackUsers() {
  // In a large-scale app, you'd want to paginate this query
  // For simplicity, we're assuming a reasonable number of users
  
  // Find all users with Slack integration configured (slackUserId is set)
  const allUsers = (await storage.getAllUsers()).filter(user => user.slackUserId);
  return allUsers;
}

/**
 * Sleep function to help rate-limit API calls
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Checks for new tasks for a specific user
 * @param userId - Database user ID
 * @param slackUserId - Slack user ID
 * @param slackAccessToken - User's Slack access token
 */
async function checkUserTasks(userId: number, slackUserId: string, slackAccessToken: string | null) {
  try {
    // Get channels the user wants to monitor
    const channelIds = await getChannelPreferences(userId);
    
    if (channelIds.length === 0) {
      // Skip users who haven't configured channels to monitor
      return;
    }
    
    console.log(`Checking ${channelIds.length} channels for user ${userId} (${slackUserId})`);
    
    // For each channel, get messages since the last check
    const tasks = await detectTasks(channelIds, slackUserId, slackAccessToken);
    console.log(`Found ${tasks.length} potential tasks for user ${userId}`);
    
    // Batch process tasks to avoid rate limiting
    // Process tasks with adaptive rate limiting
    const BATCH_SIZE = 3; // Reduced from 5 to 3
    const BATCH_DELAY = 5000; // Increased from 2s to 5s
    const MESSAGE_DELAY = 2000; // Increased from 1s to 2s
    const MAX_TASKS_TO_PROCESS = 25; // Cap the maximum number of tasks to process in one cycle
    
    // Limit the number of tasks to avoid excessive notifications
    const tasksToProcess = tasks.slice(0, MAX_TASKS_TO_PROCESS);
    if (tasksToProcess.length < tasks.length) {
      console.log(`Limiting to ${MAX_TASKS_TO_PROCESS} tasks out of ${tasks.length} detected`);
    }
    
    // Track rate limit errors to adaptively adjust delays
    let rateLimitErrors = 0;
    let currentMessageDelay = MESSAGE_DELAY;
    let currentBatchDelay = BATCH_DELAY;
    
    for (let i = 0; i < tasksToProcess.length; i += BATCH_SIZE) {
      // Get a batch of tasks
      const batch = tasksToProcess.slice(i, i + BATCH_SIZE);
      
      // Process this batch
      for (const task of batch) {
        try {
          // Skip messages we've already processed
          if (await isTaskAlreadyProcessed(task.ts)) {
            continue;
          }
          
          // Send an interactive DM to the user
          console.log(`Sending task detection DM for message ${task.ts}`);
          await sendTaskDetectionDM(slackUserId, task);
          
          // Mark this message as processed to avoid duplicates
          markTaskAsProcessed(task.ts);
          
          // If we got here without error, we can slightly decrease the delay
          // but not below the minimum
          if (rateLimitErrors > 0) {
            rateLimitErrors--;
          }
          
          // Small delay between individual messages within a batch
          // Use adaptive delay based on rate limit errors
          const adaptiveDelay = currentMessageDelay * (1 + rateLimitErrors * 0.5);
          console.log(`Waiting ${adaptiveDelay}ms before next message...`);
          await sleep(adaptiveDelay);
        } catch (error: any) {
          // Check if the error is a rate limit error
          if (error.code === 'slack_webapi_platform_error' && 
              error.data && error.data.error === 'ratelimited') {
            // Increment rate limit error counter
            rateLimitErrors++;
            
            // Use the retry-after value if available, otherwise increase exponentially
            const retryAfter = error.retryAfter || Math.pow(2, rateLimitErrors) * 1000;
            console.log(`Rate limited. Waiting ${retryAfter}ms before continuing...`);
            
            // Update delays for future messages
            currentMessageDelay = Math.min(currentMessageDelay * 1.5, 5000); // Max 5s
            currentBatchDelay = Math.min(currentBatchDelay * 1.5, 10000); // Max 10s
            
            await sleep(retryAfter);
            
            // Try to process this task again
            i--; // Adjust index to retry this task
            break;
          } else {
            console.error(`Error processing task ${task.ts}:`, error);
            // Mark as processed anyway to avoid getting stuck
            markTaskAsProcessed(task.ts);
          }
        }
      }
      
      // Delay between batches if there are more tasks to process
      if (i + BATCH_SIZE < tasksToProcess.length) {
        // Use adaptive batch delay based on rate limit errors
        const adaptiveBatchDelay = currentBatchDelay * (1 + rateLimitErrors * 0.5);
        console.log(`Processed batch of ${batch.length} tasks, waiting ${adaptiveBatchDelay}ms before next batch...`);
        await sleep(adaptiveBatchDelay);
      }
    }
    
    // Update last checked timestamps for each channel
    updateLastCheckedTimestamps(channelIds);
  } catch (error) {
    console.error(`Error checking tasks for user ${userId}:`, error);
  }
}

/**
 * Checks if a task message has already been processed
 * @param messageTs - Message timestamp (used as ID)
 * @returns True if already processed
 */
async function isTaskAlreadyProcessed(messageTs: string): Promise<boolean> {
  try {
    // First, check our in-memory set for faster lookups
    if (processedMessages.has(messageTs)) {
      return true;
    }
    
    // Then, as a fallback, check if we already created a task for this message
    const existingTask = await storage.getTasksBySlackMessageId(messageTs);
    if (existingTask) {
      // If found in database but not in our set, add it to the set
      processedMessages.add(messageTs);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error checking if task is already processed:', error);
    return false;
  }
}

/**
 * Marks a task message as processed
 * @param messageTs - Message timestamp (used as ID)
 */
function markTaskAsProcessed(messageTs: string) {
  // Add to our in-memory set to prevent re-processing
  processedMessages.add(messageTs);
}

/**
 * Updates the last checked timestamp for each channel
 * @param channelIds - Array of channel IDs
 */
function updateLastCheckedTimestamps(channelIds: string[]) {
  const now = Math.floor(Date.now() / 1000).toString();
  
  channelIds.forEach(channelId => {
    lastCheckedTimestamps.set(channelId, now);
  });
  
  // Limit the size of the processedMessages set to prevent memory leaks
  // This should be done periodically to ensure it doesn't grow indefinitely
  if (processedMessages.size > 10000) {
    console.log(`Pruning processed messages cache (current size: ${processedMessages.size})`);
    // Convert to array, slice to keep the latest 5000 entries, convert back to set
    const messagesArray = Array.from(processedMessages);
    const prunedMessages = new Set(messagesArray.slice(messagesArray.length - 5000));
    processedMessages.clear();
    // Add all pruned messages back
    prunedMessages.forEach(msg => processedMessages.add(msg));
    console.log(`Processed messages cache pruned (new size: ${processedMessages.size})`);
  }
}

/**
 * Gets the status of the Slack monitoring service
 * @returns Status object with detailed monitoring information
 */
export function getMonitoringStatus() {
  return {
    active: isMonitoringActive,
    monitoredChannelsCount: lastCheckedTimestamps.size,
    processedMessagesCount: processedMessages.size,
    monitoring: {
      interval: MONITORING_INTERVAL / 1000, // Convert to seconds for readability
      lastCheckedTimestamps: Object.fromEntries(lastCheckedTimestamps.entries()),
      batchProcessingEnabled: true,
      batchSize: 3, // Corresponds to the BATCH_SIZE in checkUserTasks
      batchDelay: 5000, // ms between batches
      messageDelay: 2000, // ms between messages
      maxTasksPerCheck: 25, // Max tasks processed per check from detectTasks
      rateLimitingEnabled: true,
      adaptiveBackoff: true
    },
    memoryUsage: process.memoryUsage()
  };
}

/**
 * Clears the processed messages cache
 * This can be used to force re-processing of messages if needed
 * @param keepCount - Optional number of most recent entries to keep
 * @returns Number of cleared messages
 */
export function clearProcessedMessages(keepCount: number = 0): number {
  const originalSize = processedMessages.size;
  
  if (keepCount <= 0) {
    // Clear all
    processedMessages.clear();
    console.log(`Cleared all ${originalSize} processed messages`);
    return originalSize;
  } else {
    // Keep the most recent n messages
    const messagesArray = Array.from(processedMessages);
    const toKeep = Math.min(keepCount, messagesArray.length);
    const newMessages = new Set(messagesArray.slice(messagesArray.length - toKeep));
    
    // Calculate how many were removed
    const removedCount = originalSize - newMessages.size;
    
    // Replace the set
    processedMessages.clear();
    newMessages.forEach(m => processedMessages.add(m));
    
    console.log(`Cleared ${removedCount} processed messages, kept ${newMessages.size} most recent`);
    return removedCount;
  }
}

/**
 * Resets the monitoring service 
 * This clears processed messages and channel timestamps
 * @returns Status information about the reset
 */
export function resetMonitoring(): { 
  clearedMessages: number, 
  clearedTimestamps: number,
  monitoringActive: boolean 
} {
  const messagesCleared = clearProcessedMessages();
  
  const timestampsCount = lastCheckedTimestamps.size;
  lastCheckedTimestamps.clear();
  
  console.log(`Reset monitoring: cleared ${messagesCleared} messages and ${timestampsCount} channel timestamps`);
  
  return {
    clearedMessages: messagesCleared,
    clearedTimestamps: timestampsCount,
    monitoringActive: isMonitoringActive
  };
}