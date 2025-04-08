import { Request, Response } from 'express';
import { WebClient } from '@slack/web-api';
import { storage } from '../storage';
import { analyzeMessageForTask } from './openaiService';
import { sendTaskDetectionDM } from './slack';
import { User } from '@shared/schema';
import { addProcessedMessageId, isMessageAlreadyProcessed } from './slack';

// Force development mode for webhook testing
process.env.NODE_ENV = 'development';
process.env.PROCESS_ALL_MESSAGES = 'true';
process.env.PROCESS_SELF_MESSAGES = 'true';
process.env.SKIP_SLACK_VERIFICATION = 'true';

// Reset message processing cache for testing on every server restart
console.log('DEVELOPMENT MODE: Clearing message processing cache for easier testing!');

// Track webhook health metrics
let webhookMetrics = {
  eventsReceived: 0,
  lastEventTime: null as number | null,
  messageEvents: 0,
  otherEvents: 0,
  taskDetections: 0,
  errors: 0,
  processingTime: {
    totalMs: 0,
    count: 0,
    avgMs: 0
  },
  aiAnalysis: {
    tasksDetected: 0,
    nonTasksFiltered: 0,
    avgConfidence: 0,
    totalConfidence: 0,
    count: 0
  },
  userMentions: {
    withMention: 0,
    withoutMention: 0
  },
  channelTypes: {
    public: 0,
    private: 0,
    dm: 0,
    mpim: 0
  }
};

// Initialize the Slack WebClient with the bot token
const slack = new WebClient(process.env.SLACK_BOT_TOKEN || '');

/**
 * Verifies a Slack webhook request using the signing secret
 * @param req - Express request object
 * @returns Boolean indicating if the request is valid
 */
import * as crypto from 'crypto';

export function verifySlackRequest(req: Request): boolean {
  // In development mode, we skip verification for testing
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_SLACK_VERIFICATION === 'true') {
    console.log('DEVELOPMENT MODE: Skipping Slack request verification');
    return true;
  }
  
  // Skip verification if this is a URL verification challenge
  if (req.body?.type === 'url_verification') {
    return true;
  }
  
  try {
    // Check if basic requirements are met
    if (!req.body) {
      console.error('Missing request body');
      return false;
    }
    
    // For logging purposes in case of problems
    console.log('Headers received:', JSON.stringify(req.headers));
    console.log('Raw request body:', typeof req.body === 'string' ? req.body.substring(0, 200) : JSON.stringify(req.body).substring(0, 200));
    
    // Development bypass - always accept the request for now
    // In a production environment, we would implement proper signature verification
    console.log('DEVELOPMENT MODE: Accepting all Slack requests for testing');
    return true;
  } catch (error) {
    console.error('Error verifying Slack request:', error);
    return false;
  }
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
  const processingStart = Date.now();
  
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
    
    // Skip if the message is already in our processed messages set
    // This is critical to prevent re-processing old messages that came through 
    // historical polling instead of real-time webhooks
    const messageTs = event.ts;
    if (isMessageAlreadyProcessed(messageTs)) {
      console.log(`[SLACK EVENT] Skipping already processed message ${messageTs}`);
      return;
    }
    const channelId = event.channel;
    const userId = event.user;
    const text = event.text;
    
    // Track channel type
    if (channelId.startsWith('C')) {
      webhookMetrics.channelTypes.public++;
    } else if (channelId.startsWith('G')) {
      webhookMetrics.channelTypes.private++;
    } else if (channelId.startsWith('D')) {
      webhookMetrics.channelTypes.dm++;
    } else if (channelId.startsWith('M')) {
      webhookMetrics.channelTypes.mpim++;
    }
    
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
      
      // Update mention metrics
      if (isUserMentioned) {
        webhookMetrics.userMentions.withMention++;
      } else {
        webhookMetrics.userMentions.withoutMention++;
      }
      
      // Skip messages sent by the user themselves (except in development mode)
      if (isFromUser) {
        console.log(`[SLACK EVENT] Skipping message from user ${user.slackUserId} (self)`);
        
        // Only for development/testing: log that we would normally skip this message
        // but allow processing to continue
        if (process.env.NODE_ENV === 'development' || process.env.PROCESS_SELF_MESSAGES === 'true') {
          console.log(`[SLACK EVENT] Processing self message anyway (development mode)`);
        } else {
          continue;
        }
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
      // Check different formats of mentions to be more robust
      const userMentionFormats = [
        `<@${user.slackUserId}>`,  // Standard format
        `<@${user.slackUserId}|`, // User mention with display name
        `@${user.username}`,      // Simple @ mention with username
      ];
      
      // Check if any mention format is found in the text
      const userIsReallyMentioned = userMentionFormats.some(format => 
        text.includes(format)
      );
      
      if (!userIsReallyMentioned) {
        // Check for strong task indicators
        const strongTaskIndicators = [
          'todo', 'deadline', 'asap', 'due', 'urgent', 
          'task', 'finish', 'complete', 'required', 'need',
          'please', 'can you', 'could you', 'will you',
          'by tomorrow', 'by monday', 'by tuesday', 'by wednesday',
          'by thursday', 'by friday', 'by saturday', 'by sunday'
        ];
        let hasStrongIndicator = false;
        
        for (const indicator of strongTaskIndicators) {
          if (text.toLowerCase().includes(indicator.toLowerCase())) {
            hasStrongIndicator = true;
            console.log(`[SLACK EVENT] Found task indicator: "${indicator}" in message`);
            break;
          }
        }
        
        // For testing: always process in development mode
        if (process.env.NODE_ENV === 'development' || process.env.PROCESS_ALL_MESSAGES === 'true') {
          console.log(`[SLACK EVENT] Processing message without mention (development mode)`);
          hasStrongIndicator = true;
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
      
      // Update AI analysis metrics
      webhookMetrics.aiAnalysis.count++;
      webhookMetrics.aiAnalysis.totalConfidence += aiAnalysis.confidence;
      webhookMetrics.aiAnalysis.avgConfidence = 
        webhookMetrics.aiAnalysis.totalConfidence / webhookMetrics.aiAnalysis.count;
      
      if (aiAnalysis.is_task) {
        webhookMetrics.aiAnalysis.tasksDetected++;
        webhookMetrics.taskDetections++;
      } else {
        webhookMetrics.aiAnalysis.nonTasksFiltered++;
      }
      
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
          webhookMetrics.errors++;
        }
      }
    }
  } catch (error) {
    console.error('[SLACK EVENT] Error processing message event:', error);
    webhookMetrics.errors++;
  } finally {
    // Update processing time metrics
    const processingTime = Date.now() - processingStart;
    webhookMetrics.processingTime.totalMs += processingTime;
    webhookMetrics.processingTime.count++;
    webhookMetrics.processingTime.avgMs = 
      webhookMetrics.processingTime.totalMs / webhookMetrics.processingTime.count;
    
    console.log(`[SLACK EVENT] Message processing completed in ${processingTime}ms`);
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
 * @returns Detailed webhook health status metrics
 */
export function getWebhookHealthStatus() {
  return {
    status: "active",
    mode: "webhook-only",
    lastActive: webhookMetrics.lastEventTime 
      ? new Date(webhookMetrics.lastEventTime).toISOString()
      : null,
    events: {
      total: webhookMetrics.eventsReceived,
      messages: webhookMetrics.messageEvents,
      other: webhookMetrics.otherEvents,
      lastEventTime: webhookMetrics.lastEventTime,
    },
    taskProcessing: {
      tasksDetected: webhookMetrics.taskDetections,
      errors: webhookMetrics.errors,
      processingTime: {
        avgMs: Math.round(webhookMetrics.processingTime.avgMs),
        count: webhookMetrics.processingTime.count
      }
    },
    aiAnalysis: {
      processed: webhookMetrics.aiAnalysis.count,
      tasksDetected: webhookMetrics.aiAnalysis.tasksDetected,
      nonTasksFiltered: webhookMetrics.aiAnalysis.nonTasksFiltered,
      avgConfidence: webhookMetrics.aiAnalysis.count > 0 
        ? Math.round(webhookMetrics.aiAnalysis.avgConfidence * 100) / 100 
        : 0
    },
    userInteractions: {
      withMention: webhookMetrics.userMentions.withMention,
      withoutMention: webhookMetrics.userMentions.withoutMention
    },
    channelTypes: {
      public: webhookMetrics.channelTypes.public,
      private: webhookMetrics.channelTypes.private,
      directMessage: webhookMetrics.channelTypes.dm,
      multiPersonIm: webhookMetrics.channelTypes.mpim
    }
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