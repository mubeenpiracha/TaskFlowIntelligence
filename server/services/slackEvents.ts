import { Request, Response } from 'express';
import { WebClient } from '@slack/web-api';
import { storage } from '../storage';
import { analyzeMessageForTask } from './openaiService';
import { sendTaskDetectionDM } from './slack';
import { User } from '@shared/schema';
import { addProcessedMessageId } from './slack';

// Track webhook health metrics
let webhookMetrics = {
  eventsReceived: 0,
  lastEventTime: null as number | null,
  messageEvents: 0,
  otherEvents: 0
};

// Initialize the Slack WebClient with the bot token
const slack = new WebClient(process.env.SLACK_BOT_TOKEN || '');

/**
 * Verifies a Slack webhook request using the signing secret
 * @param req - Express request object
 * @returns Boolean indicating if the request is valid
 */
export function verifySlackRequest(req: Request): boolean {
  // In a production environment, you should implement proper
  // signature verification using the Slack signing secret
  // See: https://api.slack.com/authentication/verifying-requests-from-slack
  
  // For now, we'll just check if the request has a body
  return !!req.body;
}

/**
 * Handles URL verification challenge from Slack
 * @param req - Express request object
 * @param res - Express response object
 * @returns Boolean indicating if the request was handled
 */
export function handleUrlVerification(req: Request, res: Response): boolean {
  if (req.body.type === 'url_verification') {
    console.log('Handling Slack URL verification challenge');
    res.status(200).send({ challenge: req.body.challenge });
    return true;
  }
  return false;
}

/**
 * Process a Slack message event for task detection
 * @param event - Slack message event object
 */
export async function processMessageEvent(event: any): Promise<void> {
  try {
    // Skip bot messages, thread replies, and message edits/deletes
    if (
      event.bot_id || 
      event.subtype || 
      !event.text || 
      event.thread_ts
    ) {
      return;
    }

    const messageTs = event.ts;
    const channelId = event.channel;
    const userId = event.user;
    const text = event.text;
    
    console.log(`[SLACK EVENT] Received message: ${text?.substring(0, 50)}${text?.length > 50 ? '...' : ''}`);
    
    // Find users who are monitoring this channel
    const allUsers = await storage.getAllUsers();
    const usersMonitoringChannel = await Promise.all(
      allUsers.map(async (user) => {
        // Skip users without Slack integration
        if (!user.slackUserId) return null;
        
        // Check if this user is monitoring this channel
        try {
          const channelPrefs = user.slackChannelPreferences 
            ? JSON.parse(user.slackChannelPreferences) 
            : { channelIds: [] };
          
          if (channelPrefs.channelIds.includes(channelId)) {
            return user;
          }
        } catch (error) {
          console.error(`Error parsing channel preferences for user ${user.id}:`, error);
        }
        
        return null;
      })
    );
    
    // Filter out null results
    const relevantUsers = usersMonitoringChannel.filter(Boolean) as User[];
    
    if (relevantUsers.length === 0) {
      console.log(`[SLACK EVENT] No users monitoring channel ${channelId}`);
      return;
    }
    
    console.log(`[SLACK EVENT] Found ${relevantUsers.length} users monitoring channel ${channelId}`);
    
    // Process for each relevant user
    for (const user of relevantUsers) {
      // Skip if the message doesn't mention this user and isn't from a channel they're monitoring
      const userMention = `<@${user.slackUserId}>`;
      const isUserMentioned = text.includes(userMention);
      const isFromUser = userId === user.slackUserId;
      
      // Skip messages sent by the user themselves
      if (isFromUser) {
        console.log(`[SLACK EVENT] Skipping message from user ${user.slackUserId} (self)`);
        continue;
      }
      
      console.log(`[SLACK EVENT] Processing message for user ${user.slackUserId} (mention: ${isUserMentioned})`);
      
      // Create a message object similar to what we get from the Slack API
      const messageObj = {
        user: userId,
        text,
        ts: messageTs,
        channelId
      };
      
      // Skip if not directly mentioned and no strong task indicators
      if (!isUserMentioned) {
        // Check for strong task indicators
        const strongTaskIndicators = ['todo', 'deadline', 'asap', 'due', 'urgent'];
        let hasStrongIndicator = false;
        
        for (const indicator of strongTaskIndicators) {
          if (text.toLowerCase().includes(indicator.toLowerCase())) {
            hasStrongIndicator = true;
            break;
          }
        }
        
        if (!hasStrongIndicator) {
          console.log(`[SLACK EVENT] Skipping message - no mention and no strong task indicators`);
          continue;
        }
      }
      
      // Add to processed messages immediately to prevent duplicate processing
      addProcessedMessageId(messageTs);
      
      // Analyze the message using OpenAI
      console.log(`[SLACK EVENT] Analyzing message with OpenAI`);
      const aiAnalysis = await analyzeMessageForTask(messageObj, user.slackUserId!);
      
      // Log the analysis results
      console.log(`[SLACK EVENT] AI TASK DETECTION: ${aiAnalysis.is_task ? 'IS A TASK' : 'NOT A TASK'} (${(aiAnalysis.confidence * 100).toFixed(1)}%)`);
      console.log(`[SLACK EVENT] REASONING: ${aiAnalysis.reasoning}`);
      
      // If it's a task, send a DM to the user
      if (aiAnalysis.is_task) {
        console.log(`[SLACK EVENT] Sending task detection DM to ${user.slackUserId}`);
        try {
          // Add channel info to the message object
          const enrichedMessage = {
            ...messageObj,
            channelName: await getChannelName(channelId)
          };
          
          // Send an interactive DM to the user about the detected task
          await sendTaskDetectionDM(user.slackUserId!, enrichedMessage);
          
          console.log(`[SLACK EVENT] Successfully sent task detection DM to ${user.slackUserId}`);
        } catch (error) {
          console.error(`[SLACK EVENT] Error sending task detection DM:`, error);
        }
      }
    }
  } catch (error) {
    console.error('[SLACK EVENT] Error processing message event:', error);
  }
}

/**
 * Gets the channel name from its ID
 * @param channelId - Slack channel ID
 * @returns The channel name or a fallback
 */
async function getChannelName(channelId: string): Promise<string> {
  try {
    // Try to get the channel info
    const response = await slack.conversations.info({ channel: channelId });
    
    if (response.channel && response.channel.name) {
      return response.channel.name;
    }
    
    return channelId; // Fallback to ID if name not available
  } catch (error) {
    console.error(`Error getting channel name for ${channelId}:`, error);
    return channelId; // Fallback to ID on error
  }
}

/**
 * Get webhook health status
 * @returns Webhook health status metrics
 */
export function getWebhookHealthStatus() {
  return {
    eventsReceived: webhookMetrics.eventsReceived,
    lastEventTime: webhookMetrics.lastEventTime,
    messageEvents: webhookMetrics.messageEvents,
    otherEvents: webhookMetrics.otherEvents,
  };
}

/**
 * Handle Slack event request
 * @param req - Express request object
 * @param res - Express response object
 */
export async function handleSlackEvent(req: Request, res: Response): Promise<void> {
  try {
    // Verify the request is from Slack
    if (!verifySlackRequest(req)) {
      console.error('Invalid Slack request');
      res.status(401).send('Unauthorized');
      return;
    }
    
    // Handle URL verification challenge if present
    if (handleUrlVerification(req, res)) {
      // Update webhook metrics
      webhookMetrics.eventsReceived++;
      webhookMetrics.lastEventTime = Date.now();
      webhookMetrics.otherEvents++;
      return;
    }
    
    // Update webhook metrics for all other events
    webhookMetrics.eventsReceived++;
    webhookMetrics.lastEventTime = Date.now();
    
    // Acknowledge receipt of the event immediately
    res.status(200).send();
    
    const event = req.body.event;
    
    // Process different event types
    if (event && event.type === 'message') {
      // Update message events metric
      webhookMetrics.messageEvents++;
      
      // Process message events asynchronously
      processMessageEvent(event).catch(error => {
        console.error('Error processing message event:', error);
      });
    } else {
      // Update other events metric
      webhookMetrics.otherEvents++;
      console.log(`Received unsupported event type: ${event?.type}`);
    }
  } catch (error) {
    console.error('Error handling Slack event:', error);
    // Already sent a response, so no need to respond again
  }
}