import { WebClient } from "@slack/web-api";
import { detectTasks, sendTaskDetectionDM, testDirectMessage } from "./slack";
import { storage } from "../storage";
import { getChannelPreferences } from "./channelPreferences";
import { User } from "@shared/schema";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Get the directory name for ES modules compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Interval between monitoring cycles (in milliseconds)
// Set to 1 minute for better responsiveness while still respecting rate limits
const MONITORING_INTERVAL = 60000; // 1 minute

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
const PROCESSED_MESSAGES_FILE = path.join(
  __dirname,
  "../../processed_messages.json",
);

/**
 * Loads processed message IDs from file if it exists
 * @returns Array of message IDs
 */
function loadProcessedMessagesFromFile(): string[] {
  try {
    if (fs.existsSync(PROCESSED_MESSAGES_FILE)) {
      const fileContent = fs.readFileSync(PROCESSED_MESSAGES_FILE, "utf8");
      const data = JSON.parse(fileContent);
      if (Array.isArray(data)) {
        console.log(`Loaded ${data.length} processed message IDs from file`);
        return data;
      }
    }
  } catch (error) {
    console.error("Error loading processed messages from file:", error);
  }
  return [];
}

/**
 * Saves the current set of processed message IDs to a file
 */
function saveProcessedMessagesToFile(): void {
  try {
    const messageArray = Array.from(processedMessages);
    fs.writeFileSync(
      PROCESSED_MESSAGES_FILE,
      JSON.stringify(messageArray),
      "utf8",
    );
    console.log(`Saved ${messageArray.length} processed message IDs to file`);
  } catch (error) {
    console.error("Error saving processed messages to file:", error);
  }
}

/**
 * Preloads already processed message IDs from both file and database
 * This is used to avoid re-processing messages on restart
 */
async function preloadProcessedMessages(): Promise<void> {
  try {
    console.log("Preloading processed message IDs...");

    // First, load from file (faster and more reliable)
    const fileMessages = loadProcessedMessagesFromFile();
    fileMessages.forEach((messageId) => processedMessages.add(messageId));

    // Then, get additional IDs from database as backup
    const allUsers = await storage.getAllUsers();

    // Create an array of promises to fetch tasks for each user
    const taskPromises = allUsers.map((user) =>
      storage.getTasksByUser(user.id),
    );

    // Wait for all promises to settle
    const results = await Promise.allSettled(taskPromises);

    // Extract tasks from successful results
    const allTasks = results
      .filter(
        (result): result is PromiseFulfilledResult<any[]> =>
          result.status === "fulfilled",
      )
      .flatMap((result) => result.value)
      .filter((task) => task.slackMessageId); // Only keep tasks with Slack message IDs

    // Add all message IDs to the processed set
    let newIdsCount = 0;
    allTasks.forEach((task) => {
      if (task.slackMessageId && !processedMessages.has(task.slackMessageId)) {
        processedMessages.add(task.slackMessageId);
        newIdsCount++;
      }
    });

    console.log(
      `Preloaded ${processedMessages.size} processed message IDs (${newIdsCount} from database)`,
    );

    // Save the combined set back to file
    if (newIdsCount > 0) {
      saveProcessedMessagesToFile();
    }
  } catch (error) {
    console.error("Error preloading processed message IDs:", error);
  }
}

/**
 * Starts the background monitoring service for Slack messages
 * Only preloads processed messages (no polling)
 * @returns A cleanup function to stop monitoring
 */
export function startSlackMonitoring(): () => void {
  if (isMonitoringActive) {
    console.log(
      "Slack monitoring is already active, not starting a new instance",
    );
    return () => stopSlackMonitoring();
  }

  console.log("Starting Slack monitoring service (webhook-only mode)");
  isMonitoringActive = true;

  // Preload processed messages before starting
  void preloadProcessedMessages().then(() => {
    console.log("Processed message cache loaded - system ready for webhook events");
  });

  // Return a cleanup function
  return () => stopSlackMonitoring();
}

/**
 * Stops the Slack monitoring service
 */
function stopSlackMonitoring() {
  console.log("Stopping Slack monitoring service (webhook-only mode)");
  isMonitoringActive = false;
  
  // Save processed messages to file before stopping
  saveProcessedMessagesToFile();
  
  // The interval is not used in webhook-only mode, but we'll clear it just in case
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
}

/**
 * Checks for new tasks across all monitored users
 * This creates a checkpoint timestamp for each channel, so we only process new messages
 * Exported so it can be called manually to force an immediate check
 */
export async function checkForNewTasks() {
  try {
    console.log("Running Slack message check for all users...");

    // Get all users with Slack integration configured
    const users = await getAllSlackUsers();
    console.log(`Found ${users.length} users with Slack integration`);

    // Process each user in parallel
    await Promise.allSettled(
      users.map(async (user) => {
        try {
          await checkUserTasks(
            user.id,
            user.slackUserId!,
            user.slackAccessToken,
          );
        } catch (error) {
          console.error(`Error checking tasks for user ${user.id}:`, error);
        }
      }),
    );

    console.log("Completed Slack message check cycle");
  } catch (error) {
    console.error("Error in checkForNewTasks:", error);
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
  const allUsers = (await storage.getAllUsers()).filter(
    (user) => user.slackUserId,
  );
  return allUsers;
}

/**
 * Sleep function to help rate-limit API calls
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after the delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Checks for new tasks for a specific user
 * @param userId - Database user ID
 * @param slackUserId - Slack user ID
 * @param slackAccessToken - User's Slack access token
 */
async function checkUserTasks(
  userId: number,
  slackUserId: string,
  slackAccessToken: string | null,
) {
  try {
    // Get channels the user wants to monitor
    const channelIds = await getChannelPreferences(userId);

    if (channelIds.length === 0) {
      // Skip users who haven't configured channels to monitor
      return;
    }

    console.log(
      `Checking ${channelIds.length} channels for user ${userId} (${slackUserId})`,
    );

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
      console.log(
        `Limiting to ${MAX_TASKS_TO_PROCESS} tasks out of ${tasks.length} detected`,
      );
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
            console.log(`TASK_PROCESSING: Skipping already processed message ${task.ts}`);
            continue;
          }

          console.log(`=========== PROCESSING POTENTIAL TASK ===========`);
          console.log(`TASK_PROCESSING: Processing message with ID: ${task.ts}`);
          console.log(`TASK_PROCESSING: From channel: ${task.channelName || task.channelId}`);
          console.log(`TASK_PROCESSING: Message content: "${task.text?.slice(0, 100)}${task.text?.length > 100 ? '...' : ''}"`);
          // The userProfile field might be called differently depending on API version
          const profileName = task.user_profile?.real_name || 
                              (task as any)?.userProfile?.real_name || 
                              'Unknown';
          console.log(`TASK_PROCESSING: Sender: ${task.user} (${profileName})`);

          // Test if we can send DMs to this user first
          console.log(`TASK_PROCESSING: Testing DM capability for user ${slackUserId}...`);
          let canSendDM = await testDirectMessage(slackUserId);
          if (!canSendDM) {
            console.error(`TASK_PROCESSING: Cannot send DMs to Slack user ${slackUserId}. Skipping task notification.`);
            // Mark as processed to avoid retries
            await markTaskAsProcessed(
              task.ts,
              userId,
              task.channelId || "",
              task.text
            );
            console.log(`TASK_PROCESSING: Marked as processed to avoid future retries`);
            continue;
          }
          
          console.log(`TASK_PROCESSING: DM capability test passed for user ${slackUserId}`);
          
          // Send an interactive DM to the user
          console.log(`TASK_PROCESSING: Sending task detection DM for message ${task.ts}`);
          await sendTaskDetectionDM(slackUserId, task);

          // Mark this message as processed to avoid duplicates
          console.log(`TASK_PROCESSING: Marking message ${task.ts} as processed in database`);
          try {
            await markTaskAsProcessed(
              task.ts,
              userId,
              task.channelId || "",
              task.text,
            );
            console.log(`TASK_PROCESSING: Successfully marked task ${task.ts} as processed in database`);
          } catch (processError) {
            console.error(`TASK_PROCESSING: Failed to mark task ${task.ts} as processed in database:`, processError);
          }

          // If we got here without error, we can slightly decrease the delay
          // but not below the minimum
          if (rateLimitErrors > 0) {
            rateLimitErrors--;
          }

          // Small delay between individual messages within a batch
          // Use adaptive delay based on rate limit errors
          const adaptiveDelay =
            currentMessageDelay * (1 + rateLimitErrors * 0.5);
          console.log(`Waiting ${adaptiveDelay}ms before next message...`);
          await sleep(adaptiveDelay);
        } catch (error: any) {
          // Check if the error is a rate limit error
          if (
            error.code === "slack_webapi_platform_error" &&
            error.data &&
            error.data.error === "ratelimited"
          ) {
            // Increment rate limit error counter
            rateLimitErrors++;

            // Use the retry-after value if available, otherwise increase exponentially
            const retryAfter =
              error.retryAfter || Math.pow(2, rateLimitErrors) * 1000;
            console.log(
              `Rate limited. Waiting ${retryAfter}ms before continuing...`,
            );

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
            await markTaskAsProcessed(
              task.ts,
              userId,
              task.channelId || "unknown",
              task.text,
            );
          }
        }
      }

      // Delay between batches if there are more tasks to process
      if (i + BATCH_SIZE < tasksToProcess.length) {
        // Use adaptive batch delay based on rate limit errors
        const adaptiveBatchDelay =
          currentBatchDelay * (1 + rateLimitErrors * 0.5);
        console.log(
          `Processed batch of ${batch.length} tasks, waiting ${adaptiveBatchDelay}ms before next batch...`,
        );
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
 * Checks if a task message has already been processed or is too old
 * @param messageTs - Message timestamp (used as ID)
 * @returns True if already processed or too old
 */
async function isTaskAlreadyProcessed(messageTs: string): Promise<boolean> {
  try {
    // First, check our in-memory set for faster lookups
    if (processedMessages.has(messageTs)) {
      return true;
    }

    // Then, check if the message is older than 24 hours (to avoid spamming users with old messages)
    const messageTimestamp = parseFloat(messageTs);
    const twentyFourHoursAgo = Date.now() / 1000 - 86400; // 86400 seconds = 24 hours

    if (messageTimestamp < twentyFourHoursAgo) {
      console.log(`Skipping message ${messageTs} because it's older than 24 hours`);
      // Add to processed set to avoid checking again
      processedMessages.add(messageTs);
      return true;
    }

    // Finally, check if we already created a task for this message
    const existingTask = await storage.getTasksBySlackMessageId(messageTs);
    if (existingTask) {
      // If found in database but not in our set, add it to the set
      processedMessages.add(messageTs);
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error checking if task is already processed:", error);
    return false;
  }
}

/**
 * Marks a task message as processed by creating a task record with status = 'pending'
 * @param messageTs - Message timestamp (used as ID)
 * @param userId - User ID to associate with the task
 * @param slackChannelId - Channel where the message was detected
 * @param messageText - The text of the message to use as task title
 */
async function markTaskAsProcessed(
  messageTs: string,
  userId: number,
  slackChannelId: string,
  messageText: string,
) {
  try {
    console.log(`TASK_MARKING: Starting to mark message ${messageTs} as processed`);
    
    // First, add to our in-memory set to prevent re-processing during this session
    processedMessages.add(messageTs);
    console.log(`TASK_MARKING: Added message ${messageTs} to in-memory processed set`);
    
    // Also update the processedMessageIds set in slack.ts for OpenAI optimization
    try {
      // Import dynamically to avoid circular dependencies
      const { addProcessedMessageId } = await import('./slack');
      addProcessedMessageId(messageTs);
      console.log(`TASK_MARKING: Updated processedMessageIds cache in slack.ts for OpenAI optimization`);
    } catch (error) {
      console.error(`TASK_MARKING: Error updating processedMessageIds cache:`, error);
    }

    // Then, create a task record with status="pending" to make this persistent
    // Use a trimmed version of the message as the title (first 50 chars)
    const title =
      messageText.length > 50
        ? messageText.substring(0, 47) + "..."
        : messageText;
    
    console.log(`TASK_MARKING: Creating pending task in DB for message ${messageTs} with title: "${title.substring(0, 30)}${title.length > 30 ? '...' : ''}"`);
    console.log(`TASK_MARKING: Task data - userId: ${userId}, channelId: ${slackChannelId}, messageTs: ${messageTs}`);
    
    try {
      const task = await storage.createPendingTask(userId, messageTs, slackChannelId, title);
      console.log(`TASK_MARKING: Successfully created pending task in DB with ID ${task?.id || 'unknown'}`);
    } catch (error) {
      const dbError = error as Error;
      console.error(`TASK_MARKING: Database error creating pending task for message ${messageTs}:`, dbError);
      
      // Check if this is a duplicate key error (task might already exist)
      if (dbError.message && dbError.message.includes('duplicate key')) {
        console.log(`TASK_MARKING: Task appears to already exist in DB for message ${messageTs}, skipping creation`);
      } else {
        // Re-throw to be handled by the outer catch
        throw dbError;
      }
    }
    
    // We no longer save to the file as we rely on the database
    // This helps prevent spamming the user with old messages
    console.log(`TASK_MARKING: Completed marking message ${messageTs} as processed`);
  } catch (error) {
    console.error(`TASK_MARKING: Error marking task as processed for message ${messageTs}:`, error);
    // Still add to memory even if DB operation fails
    processedMessages.add(messageTs);
    console.log(`TASK_MARKING: Added message ${messageTs} to in-memory set despite error`);
    
    // Also update the processedMessageIds set in slack.ts despite the error
    try {
      const { addProcessedMessageId } = await import('./slack');
      addProcessedMessageId(messageTs);
      console.log(`TASK_MARKING: Updated processedMessageIds cache in slack.ts despite error`);
    } catch (updateError) {
      console.error(`TASK_MARKING: Error updating processedMessageIds cache:`, updateError);
    }
  }
}

/**
 * Updates the last checked timestamp for each channel
 * @param channelIds - Array of channel IDs
 */
function updateLastCheckedTimestamps(channelIds: string[]) {
  const now = Math.floor(Date.now() / 1000).toString();

  channelIds.forEach((channelId) => {
    lastCheckedTimestamps.set(channelId, now);
  });

  // Limit the size of the processedMessages set to prevent memory leaks
  // This should be done periodically to ensure it doesn't grow indefinitely
  if (processedMessages.size > 10000) {
    console.log(
      `Pruning processed messages cache (current size: ${processedMessages.size})`,
    );
    // Convert to array, slice to keep the latest 5000 entries, convert back to set
    const messagesArray = Array.from(processedMessages);
    const prunedMessages = new Set(
      messagesArray.slice(messagesArray.length - 5000),
    );
    processedMessages.clear();
    // Add all pruned messages back
    prunedMessages.forEach((msg) => processedMessages.add(msg));
    console.log(
      `Processed messages cache pruned (new size: ${processedMessages.size})`,
    );
  }
}

/**
 * Gets the status of the Slack monitoring service
 * @returns Status object with detailed monitoring information
 */
export function getMonitoringStatus() {
  return {
    active: isMonitoringActive,
    mode: "webhook-only",
    monitoredChannelsCount: lastCheckedTimestamps.size,
    processedMessagesCount: processedMessages.size,
    processedMessages: {
      inMemoryCacheSize: processedMessages.size,
      pruningThreshold: 10000,
      pruningTarget: 5000,
    },
    webhookSupport: {
      enabled: true,
      taskProcessingConfig: {
        batchSize: 3, // Corresponds to the BATCH_SIZE in checkUserTasks
        batchDelay: 5000, // ms between batches
        messageDelay: 2000, // ms between messages
        maxTasksPerCheck: 25, // Max tasks processed per check
        rateLimitingEnabled: true,
        adaptiveBackoff: true,
      }
    },
    pollingSupport: {
      enabled: false,
      description: "Fully migrated to webhook-based event processing"
    },
    memoryUsage: process.memoryUsage(),
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
    
    // Also clear the processed message IDs in slack.ts
    try {
      // Import dynamically to avoid circular dependencies
      import('./slack').then(slackModule => {
        if (slackModule.clearProcessedMessageIds) {
          slackModule.clearProcessedMessageIds(0);
          console.log(`Also cleared OpenAI optimization cache in slack.ts`);
        }
      }).catch(error => {
        console.error(`Error clearing OpenAI optimization cache:`, error);
      });
    } catch (error) {
      console.error(`Error importing slack module to clear cache:`, error);
    }
    
    return originalSize;
  } else {
    // Keep the most recent n messages
    const messagesArray = Array.from(processedMessages);
    const toKeep = Math.min(keepCount, messagesArray.length);
    const newMessages = new Set(
      messagesArray.slice(messagesArray.length - toKeep),
    );

    // Calculate how many were removed
    const removedCount = originalSize - newMessages.size;

    // Replace the set
    processedMessages.clear();
    newMessages.forEach((m) => processedMessages.add(m));

    console.log(
      `Cleared ${removedCount} processed messages, kept ${newMessages.size} most recent`,
    );
    
    // Also clear the processed message IDs in slack.ts
    try {
      // Import dynamically to avoid circular dependencies
      import('./slack').then(slackModule => {
        if (slackModule.clearProcessedMessageIds) {
          slackModule.clearProcessedMessageIds(toKeep);
          console.log(`Also cleared OpenAI optimization cache in slack.ts with ${toKeep} kept`);
        }
      }).catch(error => {
        console.error(`Error clearing OpenAI optimization cache:`, error);
      });
    } catch (error) {
      console.error(`Error importing slack module to clear cache:`, error);
    }
    
    return removedCount;
  }
}

/**
 * Manually trigger task detection immediately
 * In webhook-only mode, this is primarily to check the current status and configuration
 * It still performs a legacy check for backward compatibility and manual testing
 * @returns Promise with results of the check and webhook status
 */
export async function checkForNewTasksManually(): Promise<{
  success: boolean;
  mode: string;
  processedMessages: number;
  webhookStatus: {
    enabled: boolean;
    description: string;
  };
  legacyPollResult?: {
    tasksDetected: number;
    usersProcessed: number;
  };
  error?: string;
}> {
  try {
    console.log("Checking Slack monitoring status (webhook-only mode)...");
    
    // For debugging and testing purposes, we'll still run the legacy check
    // This is useful for manual verification of workspace connectivity
    console.log("Running legacy check for manual verification...");
    await checkForNewTasks();

    // Get the user count with Slack integration
    const users = await getAllSlackUsers();

    return {
      success: true,
      mode: "webhook-only",
      processedMessages: processedMessages.size,
      webhookStatus: {
        enabled: true,
        description: "System is using Slack Events API webhooks for real-time event processing"
      },
      legacyPollResult: {
        tasksDetected: processedMessages.size,
        usersProcessed: users.length
      }
    };
  } catch (error) {
    console.error("Error in manual Slack status check:", error);
    return {
      success: false,
      mode: "webhook-only",
      processedMessages: processedMessages.size,
      webhookStatus: {
        enabled: true,
        description: "Error occurred during manual status check"
      },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function resetMonitoring(): {
  clearedMessages: number;
  clearedTimestamps: number;
  monitoringActive: boolean;
} {
  const messagesCleared = clearProcessedMessages();

  const timestampsCount = lastCheckedTimestamps.size;
  lastCheckedTimestamps.clear();

  console.log(
    `Reset monitoring: cleared ${messagesCleared} messages and ${timestampsCount} channel timestamps`,
  );

  return {
    clearedMessages: messagesCleared,
    clearedTimestamps: timestampsCount,
    monitoringActive: isMonitoringActive,
  };
}
