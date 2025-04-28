import { storage } from "../storage";
import { User } from "@shared/schema";
import { getWebhookHealthStatus } from "./slackEvents";

// Flag to track if monitoring is active
let isMonitoringActive = false;

/**
 * Gets all users who have Slack integration set up
 * @returns Array of users with their Slack info
 */
export async function getAllSlackUsers(): Promise<User[]> {
  // Find all users with Slack integration configured (slackUserId is set)
  const allUsers = (await storage.getAllUsers()).filter(
    (user) => user.slackUserId,
  );
  return allUsers;
}

/**
 * Manually trigger webhook status check
 * This is primarily to check the current status and configuration
 * No actual scanning is performed as webhooks handle all events in real-time
 * @returns Promise with results of the webhook status
 */
export async function checkForNewTasksManually(): Promise<{
  success: boolean;
  mode: string;
  processedMessages: number;
  webhookStatus: {
    enabled: boolean;
    description: string;
    details?: any;
  };
  tasksDetected: number;
  usersProcessed: number;
  error?: string;
}> {
  try {
    console.log("Checking Slack webhook status...");
    
    // Get the user count with Slack integration
    const users = await getAllSlackUsers();
    
    // Get webhook status metrics
    let webhookMetrics;
    try {
      webhookMetrics = getWebhookHealthStatus();
    } catch (e) {
      console.error("Error getting webhook health status:", e);
      webhookMetrics = { 
        status: "active",
        mode: "webhook-only",
        events: { total: 0 }
      };
    }
    
    console.log("Webhook-only mode is active - no polling performed");
    
    const eventsTotal = webhookMetrics.events?.total || 0;
    return {
      success: true,
      mode: "webhook-only",
      processedMessages: 0, // No processed messages in webhook mode
      tasksDetected: eventsTotal,
      webhookStatus: {
        enabled: true,
        description: `Using Slack Events API webhooks (${eventsTotal} events received)`,
        details: webhookMetrics
      },
      usersProcessed: users.length
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Error in manual Slack status check:", error);
    return {
      success: false,
      mode: "webhook-only",
      processedMessages: 0,
      tasksDetected: 0,
      webhookStatus: {
        enabled: true,
        description: "Error occurred during manual status check"
      },
      usersProcessed: 0,
      error: errorMessage
    };
  }
}

/**
 * Starts the webhook monitoring service for Slack events
 * This simply sets up the system to handle incoming webhook events
 * No polling or message caching is performed
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
  
  console.log("System ready for webhook events");

  // Return a cleanup function
  return () => stopSlackMonitoring();
}

/**
 * Stops the Slack monitoring service
 */
function stopSlackMonitoring() {
  console.log("Stopping Slack monitoring service (webhook-only mode)");
  isMonitoringActive = false;
}

/**
 * Reset operation for admin use - now a no-op as we don't keep cache
 * Kept for API compatibility
 */
export function resetMonitoring(): {
  note: string;
  monitoringActive: boolean;
} {
  console.log("Reset monitoring requested - no action needed in webhook-only mode");

  return {
    note: "No action needed in webhook-only mode - we don't maintain message caches",
    monitoringActive: isMonitoringActive,
  };
}

/**
 * Get the current status of the Slack monitoring service
 * @returns Status information about the monitoring service
 */
export function getMonitoringStatus(): {
  active: boolean;
  mode: string;
  startTime: number;
  lastActivity: number;
} {
  return {
    active: isMonitoringActive,
    mode: "webhook-only",
    startTime: Date.now(), // Use current time as we don't track actual start time
    lastActivity: Date.now() // Use current time as we don't track actual activity
  };
}

/**
 * Clears processed messages from the cache (stub function for API compatibility)
 * In webhook-only mode, we don't maintain a message cache, so this is a no-op
 * @param keepCount Number of most recent messages to keep (ignored in webhook mode)
 * @returns The number of messages cleared (always 0 in webhook mode)
 */
export function clearProcessedMessages(keepCount: number = 0): number {
  console.log(`Clear processed messages requested (keepCount: ${keepCount}) - no action needed in webhook-only mode`);
  // Always return 0 as we don't maintain a message cache in webhook-only mode
  return 0;
}