import { storage } from "../storage";
import { User } from "@shared/schema";
import { analyzeMessageForTask } from "./openaiService";
import { getChannelPreferences } from "./channelPreferences";
import { createTaskFromSlackMessage, sendTaskConfirmation } from "./taskCreation";
import { getUserTimezone } from "./slack";

// Metrics for webhook health monitoring
interface WebhookMetrics {
  status: "active" | "inactive";
  mode: "webhook-only";
  lastActive: string | null;
  events: {
    total: number;
    messages: number;
    other: number;
    lastEventTime: number | null;
  };
  taskProcessing: {
    messagesAnalyzed: number;
    tasksDetected: number;
    tasksCreated: number;
  };
  aiAnalysis: {
    successful: number;
    failed: number;
    lastAnalysisTime: number | null;
  };
  userInteractions: {
    confirmations: number;
    rejections: number;
    lastInteractionTime: number | null;
  };
}

// Initialize metrics
const webhookMetrics: WebhookMetrics = {
  status: "active",
  mode: "webhook-only",
  lastActive: null,
  events: {
    total: 0,
    messages: 0,
    other: 0,
    lastEventTime: null
  },
  taskProcessing: {
    messagesAnalyzed: 0,
    tasksDetected: 0,
    tasksCreated: 0
  },
  aiAnalysis: {
    successful: 0,
    failed: 0,
    lastAnalysisTime: null
  },
  userInteractions: {
    confirmations: 0,
    rejections: 0,
    lastInteractionTime: null
  }
};

/**
 * Get the current webhook health status
 * @returns Webhook metrics object
 */
export function getWebhookHealthStatus(): WebhookMetrics {
  return {
    ...webhookMetrics,
    lastActive: webhookMetrics.lastActive || new Date().toISOString()
  };
}

/**
 * Handle a Slack event received via webhook
 * @param event The event payload from Slack
 * @returns Processing result
 */
export async function handleSlackEvent(event: any): Promise<{
  success: boolean;
  eventType: string;
  processed: boolean;
  taskDetected?: boolean;
  message?: string;
  error?: string;
}> {
  try {
    // Update metrics
    webhookMetrics.events.total++;
    webhookMetrics.events.lastEventTime = Date.now();
    webhookMetrics.lastActive = new Date().toISOString();

    // Handle URL verification challenge from Slack
    if (event.type === "url_verification") {
      webhookMetrics.events.other++;
      return {
        success: true,
        eventType: "url_verification",
        processed: true,
        message: "URL verification challenge processed"
      };
    }

    // Extract the event details from the wrapper
    const slackEvent = event.event;
    if (!slackEvent) {
      webhookMetrics.events.other++;
      return {
        success: false,
        eventType: "unknown",
        processed: false,
        message: "No event data found in payload"
      };
    }

    // Process different event types
    if (slackEvent.type === "message") {
      webhookMetrics.events.messages++;
      
      // Skip bot messages, message changes, and deleted messages
      const skipMessage = 
        slackEvent.subtype === "bot_message" || 
        slackEvent.subtype === "message_changed" || 
        slackEvent.subtype === "message_deleted";
      
      if (skipMessage) {
        return {
          success: true,
          eventType: "message",
          processed: true,
          taskDetected: false,
          message: `Skipped ${slackEvent.subtype || "special"} message`
        };
      }

      return await processMessageEvent(slackEvent, event.team_id);

    } else {
      // Not a message event
      webhookMetrics.events.other++;
      return {
        success: true,
        eventType: slackEvent.type,
        processed: true,
        message: `Non-message event type: ${slackEvent.type}`
      };
    }
  } catch (error) {
    console.error("Error processing Slack event:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      eventType: "error",
      processed: false,
      error: errorMessage,
      message: "Error processing Slack event"
    };
  }
}

/**
 * Process a message event from Slack
 * @param message The message event from Slack
 * @param teamId The Slack workspace/team ID
 * @returns Processing result
 */
async function processMessageEvent(message: any, teamId: string): Promise<{
  success: boolean;
  eventType: string;
  processed: boolean;
  taskDetected: boolean;
  message?: string;
  error?: string;
}> {
  try {
    // Basic validation
    if (!message.text || !message.user || !message.ts || !message.channel) {
      return {
        success: false,
        eventType: "message",
        processed: false,
        taskDetected: false,
        message: "Invalid message data"
      };
    }

    // Find the user who configured the integration
    const slackUser = await getUserForSlackMessage(message.user, teamId);
    if (!slackUser) {
      return {
        success: true,
        eventType: "message",
        processed: false,
        taskDetected: false,
        message: "No user found with this Slack configuration"
      };
    }

    // Check if this channel is in the user's monitored channels
    try {
      const channelIds = await getChannelPreferences(slackUser.id);
      
      // TEMPORARY TESTING OVERRIDE: Process messages even if channel is not in preferences
      // This helps during development and testing
      const isDevelopmentMode = process.env.NODE_ENV !== 'production';
      if (!isDevelopmentMode && !channelIds.includes(message.channel)) {
        return {
          success: true,
          eventType: "message",
          processed: false,
          taskDetected: false,
          message: "Channel not in user's monitored channels"
        };
      }
      
      console.log(`Processing message in channel ${message.channel} for user ${slackUser.username || slackUser.id}`);
    } catch (prefError) {
      console.error("Error checking channel preferences:", prefError);
      // Continue processing the message even if we can't check preferences (fail open for testing)
    }

    // Detect tasks in the message using AI
    webhookMetrics.taskProcessing.messagesAnalyzed++;
    
    console.log(`Analyzing message for tasks: "${message.text.substring(0, 30)}..."`);
    
    // Create a proper SlackMessage object for analysis
    const slackMessage: SlackMessage = {
      user: message.user,
      text: message.text,
      ts: message.ts,
      channelId: message.channel,
      channelName: `channel-${message.channel}` // Simple placeholder name
    };
    
    // Pass in the actual user ID as well for mention detection
    const analysis = await analyzeMessageForTask(slackMessage, slackUser.slackUserId || message.user);
    
    if (analysis.is_task) {
      webhookMetrics.taskProcessing.tasksDetected++;
      webhookMetrics.aiAnalysis.successful++;
      webhookMetrics.aiAnalysis.lastAnalysisTime = Date.now();
      
      console.log(`Task detected: ${analysis.task_title || 'Untitled task'}`);
      
      // Get user timezone
      let timezone = slackUser.timezone || "UTC";
      try {
        if (slackUser.slackUserId) {
          const slackTimezone = await getUserTimezone(slackUser.slackUserId);
          if (slackTimezone) {
            timezone = slackTimezone;
          }
        }
      } catch (tzError) {
        console.warn("Could not get user timezone from Slack:", tzError);
      }
      
      // Determine priority from urgency if available
      let priority = "medium";
      if (analysis.urgency) {
        if (analysis.urgency >= 4) priority = "high";
        else if (analysis.urgency <= 2) priority = "low";
      }
      
      // Convert time_required_minutes to a string format (e.g., "30m" or "2h")
      let timeRequired = "";
      if (analysis.time_required_minutes) {
        if (analysis.time_required_minutes < 60) {
          timeRequired = `${analysis.time_required_minutes}m`;
        } else {
          const hours = Math.floor(analysis.time_required_minutes / 60);
          const minutes = analysis.time_required_minutes % 60;
          timeRequired = minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
        }
      }
      
      // Create a pending task
      await createTaskFromSlackMessage({
        user: message.user,
        text: message.text,
        ts: message.ts,
        channelId: message.channel,
        channelName: `channel-${message.channel}`, // Simple fallback name
        title: analysis.task_title || "Task from Slack",
        deadline: analysis.deadline,
        priority,
        timeRequired,
        timezone
      });
      
      // Send confirmation message to user
      await sendTaskConfirmation(slackUser, message, analysis);
      webhookMetrics.taskProcessing.tasksCreated++;
      
      return {
        success: true,
        eventType: "message",
        processed: true,
        taskDetected: true,
        message: `Task detected: ${analysis.task_title || 'Untitled task'}`
      };
    } else {
      // Not a task
      return {
        success: true,
        eventType: "message",
        processed: true,
        taskDetected: false,
        message: "Message analyzed - no task detected"
      };
    }
  } catch (error) {
    console.error("Error processing message event:", error);
    webhookMetrics.aiAnalysis.failed++;
    
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      eventType: "message",
      processed: false,
      taskDetected: false,
      error: errorMessage,
      message: "Error processing message event"
    };
  }
}

/**
 * Find the user with the matching Slack user ID
 * @param slackUserId User ID from Slack event
 * @param workspaceId Slack workspace/team ID
 * @returns User record if found
 */
async function getUserForSlackMessage(slackUserId: string, workspaceId: string): Promise<User | undefined> {
  // First try to find by exact Slack user ID
  const user = await storage.getUserBySlackUserId(slackUserId);
  if (user) {
    return user;
  }
  
  // If no direct match, get all users for this workspace
  const allUsers = await storage.getAllUsers();
  return allUsers.find(user => 
    user.slackUserId && user.slackWorkspace === workspaceId
  );
}