import { WebClient } from '@slack/web-api';
import { detectTasks, sendTaskDetectionDM } from './slack';
import { storage } from '../storage';
import { getChannelPreferences } from './channelPreferences';
import { User } from '@shared/schema';

// Interval between monitoring cycles (in milliseconds)
// Default: 1 minute
const MONITORING_INTERVAL = 60000;

// Map to track the last checked timestamp for each channel
const lastCheckedTimestamps: Map<string, string> = new Map();

// Flag to track if monitoring is active
let isMonitoringActive = false;
let monitoringInterval: NodeJS.Timeout | null = null;

/**
 * Starts the background monitoring service for Slack messages
 * @returns A cleanup function to stop monitoring
 */
export function startSlackMonitoring(): () => void {
  if (isMonitoringActive) {
    console.log('Slack monitoring is already active, not starting a new instance');
    return () => stopSlackMonitoring();
  }
  
  console.log('Starting Slack monitoring service');
  isMonitoringActive = true;
  
  // Run initial check
  void checkForNewTasks();
  
  // Set up recurring monitoring
  monitoringInterval = setInterval(async () => {
    void checkForNewTasks();
  }, MONITORING_INTERVAL);
  
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
    
    // For each detected task, check if it's already processed and send a DM if it's new
    for (const task of tasks) {
      // Skip messages we've already processed
      if (await isTaskAlreadyProcessed(task.ts)) {
        continue;
      }
      
      // Send an interactive DM to the user
      console.log(`Sending task detection DM for message ${task.ts}`);
      await sendTaskDetectionDM(slackUserId, task);
      
      // Mark this message as processed to avoid duplicates
      markTaskAsProcessed(task.ts);
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
    // Check if we already created a task for this message
    const existingTask = await storage.getTasksBySlackMessageId(messageTs);
    return !!existingTask;
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
  // In a more sophisticated system, we might store this in a database
  // For now, we're just relying on the tasks table
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
}

/**
 * Gets the status of the Slack monitoring service
 * @returns Status object
 */
export function getMonitoringStatus() {
  return {
    active: isMonitoringActive,
    monitoredChannelsCount: lastCheckedTimestamps.size,
    lastCheckedTimestamps: Object.fromEntries(lastCheckedTimestamps.entries())
  };
}