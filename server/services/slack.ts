import { WebClient } from '@slack/web-api';
import type { ConversationsHistoryResponse } from '@slack/web-api';
import { extractTaskTitle, extractDueDate, determinePriority, estimateTimeRequired } from './taskCreation';
import { storage } from '../storage';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { BASE_URL } from '../config';

if (!process.env.SLACK_BOT_TOKEN) {
  console.warn("SLACK_BOT_TOKEN environment variable is not set - Slack bot operations will not work");
}

// Initialize the Slack WebClient with the bot token for bot-only operations
// This will be used as a fallback when user token is not available
export const slack = new WebClient(process.env.SLACK_BOT_TOKEN || '');

/**
 * Get the Slack client instance with the bot token
 * @returns Slack WebClient instance
 */
export function getSlackClientBot(): WebClient {
  if (!process.env.SLACK_BOT_TOKEN) {
    throw new Error('SLACK_BOT_TOKEN is not set in the environment');
  }
  return slack;
}

/**
 * Create a Slack client using a user's token
 * This allows access to private channels and DMs the bot might not have access to
 * @param userToken User's Slack access token (xoxp-)
 * @returns WebClient instance with user token
 */
export function createUserClient(userToken: string): WebClient {
  if (!userToken) {
    throw new Error('User token is required to create a user client');
  }
  return new WebClient(userToken);
}

export interface SlackChannel {
  id: string;
  name: string;
  is_member: boolean;
  is_private: boolean;
  is_channel: boolean;
  num_members?: number;
}

export interface SlackMessage {
  user: string;
  text: string;
  ts: string;
  user_profile?: {
    image_72?: string;
    display_name?: string;
    real_name?: string;
  };
  channelId?: string;
  channelName?: string;
  // Custom fields from interactive messages
  customTitle?: string;
  customDescription?: string;
  customPriority?: 'high' | 'medium' | 'low';
  customTimeRequired?: string;
  customDueDate?: string;
  customDueTime?: string;
  customUrgency?: number;
  customImportance?: number;
  customRecurringPattern?: string | null;
  workspaceId?: number;
}

/**
 * Convert Slack timezone string to IANA format for Google Calendar
 * 
 * @param slackTimezone - Timezone string from Slack API
 * @returns Valid IANA timezone string for Google Calendar
 */
function convertToIANATimezone(slackTimezone: string): string {
  // Slack already provides IANA format timezone strings in most cases
  // This function provides a way to handle any exceptions
  
  // Map of known problematic Slack timezone strings to IANA timezone strings
  const timezoneMap: Record<string, string> = {
    // Commonly problematic timezone strings
    'EST': 'America/New_York',
    'EDT': 'America/New_York',
    'CST': 'America/Chicago',
    'CDT': 'America/Chicago',
    'MST': 'America/Denver',
    'MDT': 'America/Denver',
    'PST': 'America/Los_Angeles',
    'PDT': 'America/Los_Angeles',
    // Default fallback is UTC
    'GMT': 'UTC',
    'UTC': 'UTC'
  };
  
  console.log(`[TIMEZONE DEBUG] Converting Slack timezone: ${slackTimezone}`);
  
  // Return mapped timezone if it exists, otherwise return original (assuming it's valid IANA)
  const ianaTimezone = timezoneMap[slackTimezone] || slackTimezone;
  
  console.log(`[TIMEZONE DEBUG] Converted to IANA timezone: ${ianaTimezone}`);
  return ianaTimezone;
}

/**
 * Gets a user's timezone information from Slack
 * @param userId - Slack user ID
 * @returns Timezone and timezone_offset
 */
export async function getUserTimezone(userId: string): Promise<{ timezone: string; timezone_offset: number }> {
  console.log(`[TIMEZONE DEBUG] getUserTimezone called for userId: ${userId}`);
  
  if (!slack) {
    console.error('[TIMEZONE DEBUG] Slack client not initialized');
    throw new Error("Slack client not initialized - check SLACK_BOT_TOKEN environment variable");
  }
  
  try {
    console.log(`[TIMEZONE DEBUG] Making Slack API call to users.info for user: ${userId}`);
    const result = await slack.users.info({
      user: userId
    });
    
    if (!result.user) {
      console.error(`[TIMEZONE DEBUG] User not found in Slack response: ${userId}`);
      throw new Error(`User not found: ${userId}`);
    }
    
    // Log the complete user object for debugging
    console.log(`[TIMEZONE DEBUG] Full Slack user object for debugging:`, JSON.stringify({
      id: result.user.id,
      name: result.user.name,
      real_name: result.user.real_name,
      tz: result.user.tz,
      tz_offset: result.user.tz_offset,
      tz_label: result.user.tz_label
    }));
    
    // Default to UTC if timezone info is missing
    const slackTimezone = result.user.tz || 'UTC';
    const timezone_offset = result.user.tz_offset || 0;
    
    // Convert to IANA timezone format for Google Calendar
    const ianaTimezone = convertToIANATimezone(slackTimezone);
    
    console.log(`[TIMEZONE DEBUG] Original Slack timezone: ${slackTimezone}, Converted IANA timezone: ${ianaTimezone}, Offset: ${timezone_offset}`);
    
    return {
      timezone: ianaTimezone,
      timezone_offset: timezone_offset
    };
  } catch (error) {
    console.error('[TIMEZONE DEBUG] Error getting Slack user timezone:', error);
    // Return UTC as fallback
    return { timezone: 'UTC', timezone_offset: 0 };
  }
}

/**
 * Lists all channels that the authenticated user is a member of
 * Note: This will only return channels the bot is a member of
 * @returns Promise with list of channels
 */
export async function listUserChannels(userToken?: string | null): Promise<SlackChannel[]> {
  // Use user token for listing channels when available, as it gives access to private channels
  // the user is in, but the bot might not be
  if (!userToken && (!process.env.SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN.trim() === '')) {
    console.error('No Slack tokens available');
    throw new Error('Slack token is missing or empty. Please check your environment variables or reconnect your Slack account.');
  }
  
  // Use the user token if provided, otherwise fall back to bot token
  const client = userToken ? new WebClient(userToken) : slack;
  
  try {
    // Validate the token first
    try {
      const authTest = await client.auth.test();
      console.log('Using Slack token for user:', authTest.user, 'user_id:', authTest.user_id);
    } catch (authError: any) {
      if (authError.data && authError.data.error === 'invalid_auth') {
        console.error('Slack token is invalid or expired:', authError.data.error);
        throw new Error('SLACK_AUTH_ERROR: Your Slack token is invalid or expired. Please reconnect your Slack account.');
      }
      throw authError;
    }
    
    // When using user token, we can get all types of conversations the user is in
    // This includes private channels and DMs the bot might not have access to
    const conversationTypes = userToken 
      ? 'public_channel,private_channel,mpim,im' // User token gives access to everything
      : 'public_channel,private_channel'; // Bot token limited to channels it's invited to
    
    // Get conversations the user is a member of
    const result = await client.users.conversations({
      types: conversationTypes,
      exclude_archived: true,
      limit: 1000
    });
    
    // Get auth info to identify own user ID
    const authInfo = await client.auth.test();
    const selfUserId = authInfo.user_id;
    
    // Get bot user ID
    let botUserId = 'USLACKBOT'; // Default Slackbot ID
    try {
      // Try to get the app's bot user ID if possible
      const botInfo = await slack.auth.test();
      if (botInfo.bot_id) {
        botUserId = botInfo.user_id;
      }
    } catch (error) {
      console.log('Could not determine bot user ID, using default Slackbot ID');
    }
    
    // Process the channels, only filter out DMs with bot
    const channels = [];
    
    for (const channel of (result.channels || [])) {
      // Skip only DMs with the bot or Slackbot
      if (channel.is_im && (channel.user === botUserId || channel.user === 'USLACKBOT')) {
        continue;
      }
      
      // For DMs, try to get user name instead of ID
      let name = channel.name;
      if (!name && channel.is_im && channel.user) {
        try {
          const userInfo = await client.users.info({ user: channel.user });
          if (userInfo.user) {
            const displayName = userInfo.user.profile?.display_name || userInfo.user.profile?.real_name || userInfo.user.name;
            name = `DM with ${displayName}`;
          } else {
            name = `DM with ${channel.user}`;
          }
        } catch (error) {
          console.log(`Could not get user info for ${channel.user}`, error);
          name = `DM with ${channel.user}`;
        }
      }
      
      channels.push({
        id: channel.id,
        name: name || `DM with ${channel.user || 'Unknown'}`,
        is_member: true, // users.conversations only returns channels the user is a member of
        is_private: channel.is_private || false,
        is_channel: channel.is_channel !== false,
        num_members: channel.num_members
      });
    }
    
    return channels;
  } catch (error) {
    console.error('Error listing Slack channels:', error);
    // Re-throw so the route handler can deal with it appropriately
    throw error;
  }
}

/**
 * Gets user info from Slack
 * @param userId - Slack user ID
 * @param userToken - Optional user token for accessing private user data
 * @returns Promise with user information
 */
/**
 * Format a date for display in Slack messages
 * @param date The date to format
 * @returns Formatted date string in YYYY-MM-DD format
 */
export function formatDateForSlack(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Get a channel name from its ID
 * @param channelId Slack channel ID
 * @returns Channel name or undefined if not found
 */
export async function getChannelName(channelId: string): Promise<string | undefined> {
  try {
    // For DM channels, which start with 'D'
    if (channelId.startsWith('D')) {
      return 'direct-message';
    }
    
    // For regular channels
    const result = await slack.conversations.info({ channel: channelId });
    return result.channel?.name;
  } catch (error) {
    console.error(`Error getting channel name for ${channelId}:`, error);
    return undefined;
  }
}

export async function getUserInfo(userId: string, userToken?: string | null) {
  // Use user token when available for better access to user data
  const client = userToken ? new WebClient(userToken) : slack;
  
  try {
    const result = await client.users.info({ user: userId });
    return result.user;
  } catch (error) {
    console.error('Error getting user info:', error);
    
    // If using bot token and getting access errors, log specific message
    if (!userToken && error instanceof Error && 
       (error.message.includes('not_authorized') || 
        error.message.includes('missing_scope'))) {
      console.warn(`Bot doesn't have access to user data for ${userId}. Consider using user token for this operation.`);
    }
    
    return null;
  }
}

/**
 * Reads the history of messages in a channel
 * @param channelId - Channel ID to read message history from
 * @param messageLimit - Maximum number of messages to retrieve
 * @returns Promise resolving to the messages
 */
export async function readChannelHistory(
  channelId: string,
  messageLimit: number = 100,
  userToken?: string | null
): Promise<SlackMessage[]> {
  // Use user token when available, especially for private channels and DMs
  // This allows access to private conversations the bot might not have access to
  const client = userToken ? new WebClient(userToken) : slack;
  
  try {
    // Get messages - using user token provides access to private channels and DMs
    const result = await client.conversations.history({
      channel: channelId,
      limit: messageLimit,
    });

    // For each message, get the user profile, using the same token we used for channel access
    const messages = await Promise.all((result.messages || []).map(async (message: any) => {
      let userProfile = null;
      if (message.user) {
        // Pass the same user token to getUserInfo that we used for reading the channel history
        const userInfo = await getUserInfo(message.user, userToken);
        userProfile = userInfo?.profile;
      }

      return {
        user: message.user,
        text: message.text,
        ts: message.ts,
        user_profile: userProfile,
        channelId
      } as SlackMessage;
    }));

    return messages;
  } catch (error) {
    console.error(`Error reading Slack channel history for ${channelId}:`, error);
    
    // If using bot token and getting access errors, log specific message
    if (!userToken && error instanceof Error && 
       (error.message.includes('not_in_channel') || 
        error.message.includes('channel_not_found') || 
        error.message.includes('missing_scope'))) {
      console.warn(`Bot doesn't have access to channel ${channelId}. Consider using user token for this operation.`);
    }
    
    return [];
  }
}

// Import OpenAI integration
import { analyzeMessageForTask, extractTaskDetails, TaskAnalysisResponse } from './openaiService';

// Store task analysis results for later use when sending DMs
const taskAnalysisCache = new Map<string, TaskAnalysisResponse>();

// Set to track processed message IDs for optimization
const processedMessageIds = new Set<string>();

// Helper function from above is used throughout the codebase

/**
 * Get a Slack client for the specified user
 * @param user User object with slackAccessToken
 * @returns WebClient instance
 */
export function getSlackClient(user: { slackAccessToken?: string | null }): WebClient {
  if (user.slackAccessToken) {
    return new WebClient(user.slackAccessToken);
  }
  return slack;
}

/**
 * Get information about a Slack channel
 * @param channelId Channel ID to get info for
 * @returns Channel info
 */
export async function getChannelInfo(channelId: string): Promise<{ id: string; name: string } | null> {
  try {
    const result = await slack.conversations.info({ channel: channelId });
    if (result.channel) {
      return {
        id: result.channel.id || channelId,
        name: result.channel.name || `channel-${channelId}`
      };
    }
    return null;
  } catch (error) {
    console.error(`Error getting channel info for ${channelId}:`, error);
    return null;
  }
}

/**
 * Add a message ID to the processed set for optimization
 * Used by slackMonitor.ts to update this cache when processing messages
 * @param messageId - The message ID to add
 */
export function addProcessedMessageId(messageId: string): void {
  processedMessageIds.add(messageId);
  console.log(`Added message ${messageId} to processedMessageIds cache for OpenAI optimization`);
}

/**
 * Check if a message has already been processed
 * Used to prevent duplicate processing of messages
 * @param messageId - The message ID to check
 * @returns True if the message has already been processed
 */
export function isMessageAlreadyProcessed(messageId: string): boolean {
  return processedMessageIds.has(messageId);
}

/**
 * Clear the processed message IDs set
 * Used by slackMonitor.ts when clearing processed messages
 * @param keepCount - Optional number of most recent entries to keep
 * @returns Number of cleared entries
 */
export function clearProcessedMessageIds(keepCount: number = 0): number {
  const originalSize = processedMessageIds.size;
  
  if (keepCount <= 0) {
    // Clear all
    processedMessageIds.clear();
    console.log(`Cleared all ${originalSize} message IDs from OpenAI optimization cache`);
    return originalSize;
  } else {
    // Keep the most recent n messages
    const messagesArray = Array.from(processedMessageIds);
    const toKeep = Math.min(keepCount, messagesArray.length);
    const newMessages = new Set(
      messagesArray.slice(messagesArray.length - toKeep)
    );

    // Calculate how many were removed
    const removedCount = originalSize - newMessages.size;

    // Replace the set
    processedMessageIds.clear();
    newMessages.forEach(m => processedMessageIds.add(m));

    console.log(
      `Cleared ${removedCount} message IDs from OpenAI optimization cache, kept ${newMessages.size} most recent`
    );
    return removedCount;
  }
}

// Load processed messages from file
try {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const processedMessagesPath = path.join(__dirname, '../../processed_messages.json');
  
  if (fs.existsSync(processedMessagesPath)) {
    const data = JSON.parse(fs.readFileSync(processedMessagesPath, 'utf8'));
    if (Array.isArray(data)) {
      data.forEach(id => processedMessageIds.add(id));
      console.log(`Loaded ${processedMessageIds.size} processed message IDs for optimization`);
    }
  }
} catch (error) {
  console.error('Error loading processed message IDs for optimization:', error);
}

/**
 * Checks if a message has already been processed
 * Used to decide whether to use OpenAI API or rule-based detection
 * @param messageId Message ID (ts) to check
 * @returns Promise resolving to true if the message has been processed
 */
async function isMessageProcessed(messageId: string): Promise<boolean> {
  // First check in-memory cache for performance
  if (processedMessageIds.has(messageId)) {
    return true;
  }
  
  // Then check database
  try {
    const existingTask = await storage.getTasksBySlackMessageId(messageId);
    if (existingTask) {
      // Add to in-memory cache for next time
      processedMessageIds.add(messageId);
      return true;
    }
  } catch (error) {
    console.error(`Error checking if message ${messageId} is processed:`, error);
  }
  
  return false;
}

/**
 * Analyzes a message to determine if it might contain a task
 * Uses both heuristics and OpenAI for detection
 * @param message - The message text to analyze
 * @param userId - User ID to check for mentions
 * @param messageObj - Optional full message object for OpenAI analysis
 * @returns Boolean indicating if the message likely contains a task
 */
async function isLikelyTask(message: string, userId: string, messageObj?: SlackMessage): Promise<boolean> {
  console.log(`\n================ TASK DETECTION ANALYSIS ================`);
  console.log(`ANALYZING MESSAGE: "${message.substring(0, 100)}${message.length > 100 ? '...' : ''}"`);
  console.log(`LOOKING FOR USER ID: ${userId}`);
  
  let useAI = true;
  
  try {
    // Fallback to rule-based detection if AI is disabled or fails
    if (!useAI) {
      return isLikelyTaskRuleBased(message, userId);
    }
    
    // Use OpenAI for smart task detection if we have the full message object
    if (messageObj) {
      console.log(`PERFORMING AI-BASED TASK DETECTION`);
      const aiAnalysis = await analyzeMessageForTask(messageObj, userId);
      
      // Cache analysis for later use when sending DM
      if (messageObj.ts) {
        taskAnalysisCache.set(messageObj.ts, aiAnalysis);
      }
      
      // Log analysis results
      console.log(`AI TASK DETECTION RESULT: ${aiAnalysis.is_task ? 'IS A TASK' : 'NOT A TASK'}`);
      console.log(`AI CONFIDENCE: ${(aiAnalysis.confidence * 100).toFixed(1)}%`);
      console.log(`AI REASONING: ${aiAnalysis.reasoning}`);
      
      if (aiAnalysis.is_task) {
        console.log(`AI DETECTED TASK TITLE: ${aiAnalysis.task_title || 'Not provided'}`);
        if (aiAnalysis.deadline) {
          console.log(`AI DETECTED DEADLINE: ${aiAnalysis.deadline} (${aiAnalysis.deadline_text || 'No text'})`);
        }
        if (aiAnalysis.urgency) {
          console.log(`AI DETECTED URGENCY: ${aiAnalysis.urgency}/5`);
        }
        if (aiAnalysis.importance) {
          console.log(`AI DETECTED IMPORTANCE: ${aiAnalysis.importance}/5`);
        }
        if (aiAnalysis.time_required_minutes) {
          console.log(`AI ESTIMATED TIME: ${aiAnalysis.time_required_minutes} minutes`);
        }
      }
      
      console.log(`================ END TASK DETECTION ANALYSIS ================\n`);
      return aiAnalysis.is_task;
    }
    
    // Fallback to rule-based detection if no messageObj
    return isLikelyTaskRuleBased(message, userId);
  } catch (error) {
    console.error(`Error in AI task detection:`, error);
    console.log(`FALLING BACK TO RULE-BASED DETECTION DUE TO ERROR`);
    // Fallback to rule-based detection if AI fails
    return isLikelyTaskRuleBased(message, userId);
  }
}

/**
 * Original rule-based task detection as fallback
 * Uses simple heuristics to detect potential tasks
 * @param message - The message text to analyze
 * @param userId - User ID to check for mentions
 * @returns Boolean indicating if the message likely contains a task
 */
function isLikelyTaskRuleBased(message: string, userId: string): boolean {
  // Check for task-related keywords
  const taskKeywords = [
    'todo', 'to-do', 'to do', 
    'please', 'pls', 'plz',
    'need', 'needed', 'needs',
    'should', 'must', 'have to', 
    'task', 'action',
    'by tomorrow', 'by monday', 'by tuesday', 'by wednesday', 'by thursday', 'by friday',
    'due', 'deadline',
    'urgent', 'important',
    'asap', 'as soon as possible',
    'can you', 'could you'
  ];
  
  // Check for user mention
  const userMention = `<@${userId}>`;
  const containsMention = message.includes(userMention);
  console.log(`USER MENTION CHECK: ${containsMention ? 'FOUND' : 'NOT FOUND'} "${userMention}"`);
  
  // Check if message contains task keywords
  let foundKeywords: string[] = [];
  taskKeywords.forEach(keyword => {
    if (message.toLowerCase().includes(keyword.toLowerCase())) {
      foundKeywords.push(keyword);
    }
  });
  
  const containsTaskKeyword = foundKeywords.length > 0;
  console.log(`TASK KEYWORD CHECK: ${containsTaskKeyword ? 'FOUND' : 'NOT FOUND'}`);
  if (containsTaskKeyword) {
    console.log(`MATCHED KEYWORDS: ${foundKeywords.join(', ')}`);
  }
  
  // Check for strong task indicators
  const strongTaskIndicators = ['todo', 'deadline', 'asap', 'due', 'urgent'];
  let foundStrongIndicators: string[] = [];
  
  strongTaskIndicators.forEach(keyword => {
    if (message.toLowerCase().includes(keyword.toLowerCase())) {
      foundStrongIndicators.push(keyword);
    }
  });
  
  const hasStrongIndicator = foundStrongIndicators.length > 0;
  console.log(`STRONG INDICATOR CHECK: ${hasStrongIndicator ? 'FOUND' : 'NOT FOUND'}`);
  if (hasStrongIndicator) {
    console.log(`MATCHED STRONG INDICATORS: ${foundStrongIndicators.join(', ')}`);
  }
  
  // First condition: mentioned AND has task keyword
  const condition1 = containsMention && containsTaskKeyword;
  // Second condition: has strong indicator (even without mention)
  const condition2 = hasStrongIndicator;
  
  const isTask = condition1 || condition2;
  
  console.log(`RULE-BASED DETECTION RESULT: ${isTask ? 'IS A TASK' : 'NOT A TASK'}`);
  console.log(`DETECTION REASON: ${condition1 ? 'User mentioned + task keywords' : (condition2 ? 'Strong task indicators' : 'No conditions matched')}`);
  console.log(`================ END TASK DETECTION ANALYSIS ================\n`);
  
  return isTask;
}

/**
 * Detects potential tasks in Slack messages across multiple channels
 * @param channelIds - Array of channel IDs to analyze
 * @param userId - User ID to look for mentions of
 * @returns Promise with detected task messages, merged from all channels
 */
export async function detectTasks(
  channelIds: string[], 
  userId: string,
  userToken?: string | null
): Promise<SlackMessage[]> {
  try {
    // Log the token strategy being used
    if (userToken) {
      console.log(`Using Slack token for user: ${userId}`);
    } else {
      console.log(`Using bot token for user: ${userId} (this may limit access to private channels)`);
    }

    // Get channel names for better context
    // Use user token to see private channels
    const allChannels = await listUserChannels(userToken);
    const channelMap = new Map<string, string>();
    allChannels.forEach(channel => channelMap.set(channel.id, channel.name));
    
    // Log all channels to help with debugging
    console.log(`Found ${allChannels.length} total channels accessible: ${allChannels.map(c => c.name).join(', ')}`);
    console.log(`Monitoring ${channelIds.length} channels: ${channelIds.join(', ')}`);
    
    // Process all channels in parallel but with enhanced error handling
    const channelResults = await Promise.allSettled(channelIds.map(async (channelId) => {
      try {
        // Get channel name for logging
        const channelName = channelMap.get(channelId) || channelId;
        console.log(`Reading history for channel: ${channelName} (${channelId})`);
        
        // Only get the most recent 50 messages per channel to avoid overwhelming
        // This significantly reduces the risk of processing too many messages at once
        const messages = await readChannelHistory(channelId, 50, userToken);
        console.log(`Retrieved ${messages.length} messages from ${channelName}`);
        
        // Filter messages to only include those from the last 24 hours
        const twentyFourHoursAgo = Date.now() / 1000 - 86400; // 86400 seconds = 24 hours
        const recentMessages = messages.filter(msg => {
          const messageTimestamp = parseFloat(msg.ts);
          return messageTimestamp > twentyFourHoursAgo;
        });
        
        console.log(`Found ${recentMessages.length} messages from the last 24 hours in ${channelName}`);
        
        // Filter messages to those that likely contain tasks
        console.log(`\n=== ANALYZING MESSAGES FROM ${channelName} (${channelId}) ===`);
        
        // Process messages sequentially to avoid rate limits with OpenAI API
        const taskPromises = [];
        for (const msg of recentMessages) {
          console.log(`\nMessage [${msg.ts}] from user: ${msg.user || 'unknown'}`);
          console.log(`First 80 chars: "${msg.text?.substring(0, 80)}${msg.text?.length > 80 ? '...' : ''}"`);
          
          // Add channel ID to the message object for context
          msg.channelId = channelId;
          
          // Create a promise for each message analysis
          taskPromises.push(
            (async () => {
              try {
                // Check if the message has been processed before using OpenAI
                const isProcessed = await isMessageProcessed(msg.ts);
                
                if (isProcessed) {
                  console.log(`DETECTION OPTIMIZATION: Skipping OpenAI analysis for already processed message [${msg.ts}]`);
                  // Use rule-based detection for processed messages to save API calls
                  const result = isLikelyTaskRuleBased(msg.text, userId);
                  console.log(`DETECTION RESULT [${msg.ts}] (rule-based): ${result ? 'IS TASK' : 'NOT TASK'}`);
                  
                  if (result) {
                    return msg;
                  } else {
                    return null;
                  }
                } else {
                  // Only use OpenAI for unprocessed messages
                  console.log(`DETECTION OPTIMIZATION: Using OpenAI analysis for unprocessed message [${msg.ts}]`);
                  // Pass the full message object to enable AI-powered detection
                  const result = await isLikelyTask(msg.text, userId, msg);
                  
                  // Extra logging with timestamp for easy correlation in logs
                  console.log(`DETECTION RESULT [${msg.ts}] (AI-based): ${result ? 'IS TASK' : 'NOT TASK'}`);
                  
                  // Only return the message if it's a task
                  if (result) {
                    return msg;
                  } else {
                    return null;
                  }
                }
              } catch (error) {
                console.error(`Error analyzing message [${msg.ts}]:`, error);
                return null;
              }
            })()
          );
        }
        
        // Wait for all promises to resolve
        const taskResults = await Promise.all(taskPromises);
        
        // Filter out null results
        const taskMessages = taskResults.filter(Boolean) as SlackMessage[];
        
        console.log(`Found ${taskMessages.length} potential tasks in ${channelName} (${channelId})`);
        console.log(`=== END ANALYSIS FOR ${channelName} ===\n`);
        
        // Add channel name to each message for context
        return taskMessages.map(msg => ({
          ...msg,
          channelName: channelMap.get(msg.channelId || '') || 'unknown-channel'
        }));
      } catch (channelError) {
        console.error(`Error processing channel ${channelId}:`, channelError);
        return [];
      }
    }));
    
    // Collect successful results and flatten the array
    const successfulResults = channelResults
      .filter((result) => result.status === 'fulfilled')
      .map((result) => (result as PromiseFulfilledResult<SlackMessage[]>).value)
      .flat();
    
    // Limit the total number of tasks to process to 25 to avoid rate limiting
    // Sort by timestamp to get the most recent first
    const limitedResults = successfulResults
      .sort((a, b) => parseFloat(b.ts) - parseFloat(a.ts))
      .slice(0, 25);
    
    console.log(`Limiting to ${limitedResults.length} most recent tasks out of ${successfulResults.length} total potential tasks`);
    
    return limitedResults;
  } catch (error) {
    console.error('Error detecting tasks in Slack:', error);
    return [];
  }
}

/**
 * Sleep function for rate limiting and retries
 * @param ms - Milliseconds to sleep
 * @returns Promise that resolves after specified time
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sends a structured message to a Slack channel
 * @param channelId - Channel ID to send message to
 * @param text - Message text
 * @param blocks - Optional structured message blocks
 * @returns Promise resolving to the message timestamp
 */
export async function sendMessage(
  channelId: string,
  text: string,
  blocks?: any[],
  userToken?: string
) {
  // Use user token if provided, otherwise use the global slack client with bot token
  const client = userToken ? new WebClient(userToken) : slack;
  
  // Maximum retry attempts
  const MAX_RETRIES = 3;
  // Exponential backoff delay (ms)
  const INITIAL_DELAY = 1000; // 1 second
  
  let retries = 0;
  let response;
  
  while (retries <= MAX_RETRIES) {
    try {
      response = await client.chat.postMessage({
        channel: channelId,
        text,
        blocks,
        unfurl_links: false,
        unfurl_media: false
      });
      
      return response.ts;
    } catch (error: any) {
      // Check if the error is rate limiting related
      const isRateLimit = error.code === 'slack_webapi_platform_error' && 
                          error.data && error.data.error === 'ratelimited';
      
      retries++;
      
      if (isRateLimit && retries <= MAX_RETRIES) {
        // Get retry wait time from Slack or use exponential backoff
        const retryAfter = error.retryAfter || Math.pow(2, retries) * INITIAL_DELAY;
        console.log(`Rate limited. Retrying sendMessage after ${retryAfter}ms (attempt ${retries} of ${MAX_RETRIES})`);
        await sleep(retryAfter);
      } else if (retries <= MAX_RETRIES) {
        // For other errors, use exponential backoff
        const backoffTime = Math.pow(2, retries) * INITIAL_DELAY;
        console.log(`Error sending message. Retrying after ${backoffTime}ms (attempt ${retries} of ${MAX_RETRIES})`);
        await sleep(backoffTime);
      } else {
        console.error('Error sending Slack message after max retries:', error);
        throw error;
      }
    }
  }
  
  // This line should never be reached due to return or throw in the loop
  return undefined;
}

/**
 * Tests if the bot can send a direct message to a user
 * @param slackUserId - Slack user ID to test DM with
 * @returns Promise resolving to boolean indicating if DM is possible
 */
export async function testDirectMessage(slackUserId: string): Promise<boolean> {
  try {
    console.log(`Testing direct message capability to user ${slackUserId}`);
    const response = await slack.conversations.open({
      users: slackUserId
    });
    
    if (!response.ok) {
      console.error(`Failed to open conversation with user ${slackUserId}:`, response.error);
      return false;
    }
    
    const channelId = response.channel?.id;
    if (!channelId) {
      console.error(`No channel ID returned when opening conversation with ${slackUserId}`);
      return false;
    }
    
    console.log(`Successfully opened conversation with user ${slackUserId} in channel ${channelId}`);
    
    // Send a test message that will be invisible to the user (using ephemeral)
    // This ensures we have proper permissions without bothering the user
    const message = await slack.chat.postEphemeral({
      channel: channelId,
      user: slackUserId,
      text: "Task detection system test message (only visible to you)"
    });
    
    if (!message.ok) {
      console.error(`Failed to send test message to user ${slackUserId}:`, message.error);
      return false;
    }
    
    console.log(`Successfully sent test message to user ${slackUserId}`);
    return true;
  } catch (error) {
    console.error(`Error testing DM capability with user ${slackUserId}:`, error);
    return false;
  }
}

/**
 * Sends an interactive message to a user with task details and action buttons
 * @param slackUserId - Slack user ID to send the DM to
 * @param message - The detected Slack message that contains a potential task
 * @param userToken - Optional user's Slack access token for better permissions
 * @returns Promise resolving to the message timestamp
 */
export async function sendTaskDetectionDM(
  slackUserId: string,
  message: SlackMessage,
  userToken?: string
): Promise<string | undefined> {
  try {
    console.log(`TASK DM: Starting to send task detection DM to user ${slackUserId}`);
    console.log(`TASK DM: Message text: "${message.text.substring(0, 50)}..."`);
    console.log(`TASK DM: Using bot token: ${process.env.SLACK_BOT_TOKEN ? 'Available (starts with ' + process.env.SLACK_BOT_TOKEN.substring(0, 5) + '...)' : 'MISSING'}`);
    
    // Extract initial task information with detailed logging
    console.log(`=============== TASK_EXTRACTION_DETAILS ===============`);
    console.log(`MESSAGE_ID: ${message.ts}`);
    console.log(`FULL_MESSAGE: "${message.text}"`);
    
    // Try to get cached OpenAI analysis if available
    let aiTaskDetails = null;
    if (message.ts && taskAnalysisCache.has(message.ts)) {
      console.log(`TASK_EXTRACTION: Using cached AI analysis for message ${message.ts}`);
      aiTaskDetails = taskAnalysisCache.get(message.ts);
    }
    
    // If not in cache, perform a new analysis
    if (!aiTaskDetails) {
      try {
        console.log(`TASK_EXTRACTION: Performing new AI analysis for message ${message.ts}`);
        // Using OpenAI to extract task details
        aiTaskDetails = await extractTaskDetails(message.text);
        
        // Cache the analysis
        if (message.ts) {
          taskAnalysisCache.set(message.ts, aiTaskDetails);
        }
      } catch (error) {
        console.error(`TASK_EXTRACTION: Error in AI analysis, falling back to rule-based extraction`, error);
        // AI analysis failed, continue with rule-based extraction
      }
    }
    
    // Extract details using AI or fall back to rule-based methods
    console.log(`EXTRACTING_TITLE...`);
    const extractedTitle = aiTaskDetails?.task_title || extractTaskTitle(message.text);
    console.log(`EXTRACTED_TITLE: "${extractedTitle}"`);
    
    console.log(`EXTRACTING_DUE_DATE...`);
    let extractedDueDate = null;
    
    if (aiTaskDetails?.deadline) {
      extractedDueDate = {
        dueDate: aiTaskDetails.deadline,
        dueTime: '17:00' // Default to 5pm if AI didn't provide a time
      };
      console.log(`EXTRACTED_DUE_DATE (AI): ${extractedDueDate.dueDate} at ${extractedDueDate.dueTime}`);
      console.log(`ORIGINAL_DEADLINE_TEXT (AI): ${aiTaskDetails.deadline_text || 'Not specified'}`);
    } else {
      extractedDueDate = extractDueDate(message.text);
      console.log(`EXTRACTED_DUE_DATE (rule-based): ${extractedDueDate ? `${extractedDueDate.dueDate} at ${extractedDueDate.dueTime}` : 'None found'}`);
    }
    
    console.log(`DETERMINING_PRIORITY...`);
    const initialPriority = aiTaskDetails?.importance ? 
      (aiTaskDetails.importance >= 4 ? 'high' : (aiTaskDetails.importance >= 2 ? 'medium' : 'low')) : 
      determinePriority(message.text);
    console.log(`DETERMINED_PRIORITY: ${initialPriority}`);
    
    console.log(`ESTIMATING_TIME_REQUIRED...`);
    let initialTimeRequired = estimateTimeRequired(message.text);
    
    if (aiTaskDetails?.time_required_minutes) {
      // Convert minutes to HH:MM format
      const hours = Math.floor(aiTaskDetails.time_required_minutes / 60);
      const minutes = aiTaskDetails.time_required_minutes % 60;
      initialTimeRequired = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
      console.log(`ESTIMATED_TIME_REQUIRED (AI): ${initialTimeRequired} (${aiTaskDetails.time_required_minutes} minutes)`);
    } else {
      console.log(`ESTIMATED_TIME_REQUIRED (rule-based): ${initialTimeRequired}`);
    }
    
    console.log(`TASK_DESCRIPTION...`);
    const taskDescription = aiTaskDetails?.task_description || message.text;
    console.log(`TASK_DESCRIPTION: ${taskDescription.substring(0, 100)}${taskDescription.length > 100 ? '...' : ''}`);
    
    console.log(`TASK_CONFIDENCE: ${aiTaskDetails?.confidence || 'N/A'}`);
    console.log(`TASK_REASONING: ${aiTaskDetails?.reasoning || 'N/A'}`);
    
    console.log(`=============== END TASK_EXTRACTION_DETAILS ===============`);
    
    // Get channel name for context
    const channelReference = message.channelName 
      ? `#${message.channelName}` 
      : (message.channelId ? `<#${message.channelId}>` : 'a channel');
    
    // Format the message with task details and interactive components
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:mag: *I detected a potential task for you*\n\nI found this message in ${channelReference} that might be a task you need to handle.`
        }
      },
      {
        type: "divider"
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `>${message.text.replace(/\n/g, '\n>')}`
        }
      },
      {
        type: "divider"
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Please review and customize the task details:*"
        }
      },
      {
        type: "input",
        block_id: "task_title_block",
        label: {
          type: "plain_text",
          text: "Task Title",
          emoji: true
        },
        element: {
          type: "plain_text_input",
          action_id: "task_title_input",
          initial_value: extractedTitle,
          placeholder: {
            type: "plain_text",
            text: "Enter a title for this task"
          }
        }
      },
      {
        type: "input",
        block_id: "task_deadline_block",
        label: {
          type: "plain_text",
          text: "Deadline Date",
          emoji: true
        },
        element: {
          type: "datepicker",
          action_id: "task_deadline_date",
          initial_date: extractedDueDate?.dueDate || new Date().toISOString().split('T')[0],
          placeholder: {
            type: "plain_text",
            text: "Select a deadline date"
          }
        }
      },
      {
        type: "input",
        block_id: "task_deadline_time_block",
        label: {
          type: "plain_text",
          text: "Deadline Time",
          emoji: true
        },
        element: {
          type: "timepicker",
          action_id: "task_deadline_time",
          initial_time: extractedDueDate?.dueTime || "17:00",
          placeholder: {
            type: "plain_text",
            text: "Select a deadline time"
          }
        }
      },
      {
        type: "input",
        block_id: "task_urgency_block",
        label: {
          type: "plain_text",
          text: "Urgency (1-5)",
          emoji: true
        },
        element: {
          type: "static_select",
          action_id: "task_urgency_select",
          initial_option: {
            text: {
              type: "plain_text",
              text: "3 - Moderate",
              emoji: true
            },
            value: "3"
          },
          options: [
            {
              text: {
                type: "plain_text",
                text: "1 - Not Urgent",
                emoji: true
              },
              value: "1"
            },
            {
              text: {
                type: "plain_text",
                text: "2 - Slightly Urgent",
                emoji: true
              },
              value: "2"
            },
            {
              text: {
                type: "plain_text",
                text: "3 - Moderate",
                emoji: true
              },
              value: "3"
            },
            {
              text: {
                type: "plain_text",
                text: "4 - Urgent",
                emoji: true
              },
              value: "4"
            },
            {
              text: {
                type: "plain_text",
                text: "5 - Very Urgent",
                emoji: true
              },
              value: "5"
            }
          ]
        }
      },
      {
        type: "input",
        block_id: "task_importance_block",
        label: {
          type: "plain_text",
          text: "Importance (1-5)",
          emoji: true
        },
        element: {
          type: "static_select",
          action_id: "task_importance_select",
          initial_option: {
            text: {
              type: "plain_text",
              text: "3 - Moderately Important",
              emoji: true
            },
            value: "3"
          },
          options: [
            {
              text: {
                type: "plain_text",
                text: "1 - Not Important",
                emoji: true
              },
              value: "1"
            },
            {
              text: {
                type: "plain_text",
                text: "2 - Slightly Important",
                emoji: true
              },
              value: "2"
            },
            {
              text: {
                type: "plain_text",
                text: "3 - Moderately Important",
                emoji: true
              },
              value: "3"
            },
            {
              text: {
                type: "plain_text",
                text: "4 - Important",
                emoji: true
              },
              value: "4"
            },
            {
              text: {
                type: "plain_text",
                text: "5 - Very Important",
                emoji: true
              },
              value: "5"
            }
          ]
        }
      },
      {
        type: "input",
        block_id: "task_time_required_block",
        label: {
          type: "plain_text",
          text: "Time Required",
          emoji: true
        },
        element: {
          type: "static_select",
          action_id: "task_time_required_select",
          initial_option: {
            text: {
              type: "plain_text",
              text: "1 hour",
              emoji: true
            },
            value: "01:00"
          },
          options: [
            {
              text: {
                type: "plain_text",
                text: "15 minutes",
                emoji: true
              },
              value: "00:15"
            },
            {
              text: {
                type: "plain_text",
                text: "30 minutes",
                emoji: true
              },
              value: "00:30"
            },
            {
              text: {
                type: "plain_text",
                text: "1 hour",
                emoji: true
              },
              value: "01:00"
            },
            {
              text: {
                type: "plain_text",
                text: "1.5 hours",
                emoji: true
              },
              value: "01:30"
            },
            {
              text: {
                type: "plain_text",
                text: "2 hours",
                emoji: true
              },
              value: "02:00"
            },
            {
              text: {
                type: "plain_text",
                text: "3 hours",
                emoji: true
              },
              value: "03:00"
            },
            {
              text: {
                type: "plain_text",
                text: "4 hours",
                emoji: true
              },
              value: "04:00"
            },
            {
              text: {
                type: "plain_text",
                text: "8 hours (full day)",
                emoji: true
              },
              value: "08:00"
            }
          ]
        }
      },
      {
        type: "actions",
        block_id: "task_actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Create & Schedule Task",
              emoji: true
            },
            style: "primary",
            value: JSON.stringify({
              action: "create_task_detailed",
              ts: message.ts,
              text: message.text,
              user: message.user,
              channelId: message.channelId,
              channelName: message.channelName,
              // Include pre-detected values for reference
              detectedTitle: extractedTitle,
              detectedPriority: initialPriority,
              detectedTimeRequired: initialTimeRequired,
              detectedDueDate: extractedDueDate?.dueDate,
              detectedDueTime: extractedDueDate?.dueTime,
              // Include any AI insights
              aiUrgency: aiTaskDetails?.urgency,
              aiImportance: aiTaskDetails?.importance
            }),
            action_id: "create_task_detailed"
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Ignore",
              emoji: true
            },
            value: JSON.stringify({
              action: "ignore_task",
              ts: message.ts,
              channelId: message.channelId,
              channelName: message.channelName
            }),
            action_id: "ignore_task"
          }
        ]
      },
      {
        type: "input",
        block_id: "task_description_block",
        optional: true,
        label: {
          type: "plain_text",
          text: "Additional Notes (optional)",
          emoji: true
        },
        element: {
          type: "plain_text_input",
          action_id: "task_description_input",
          multiline: true,
          placeholder: {
            type: "plain_text",
            text: "Add any additional details or context about this task"
          }
        }
      },
      {
        type: "input",
        block_id: "task_recurring_block",
        optional: true,
        label: {
          type: "plain_text",
          text: "Recurring Task",
          emoji: true
        },
        element: {
          type: "static_select",
          action_id: "task_recurring_select",
          placeholder: {
            type: "plain_text",
            text: "How often should this task repeat?",
            emoji: true
          },
          options: [
            {
              text: {
                type: "plain_text",
                text: "One-time task (not recurring)",
                emoji: true
              },
              value: "none"
            },
            {
              text: {
                type: "plain_text",
                text: "Daily",
                emoji: true
              },
              value: "daily"
            },
            {
              text: {
                type: "plain_text",
                text: "Weekly",
                emoji: true
              },
              value: "weekly"
            },
            {
              text: {
                type: "plain_text",
                text: "Bi-weekly",
                emoji: true
              },
              value: "biweekly"
            },
            {
              text: {
                type: "plain_text",
                text: "Monthly",
                emoji: true
              },
              value: "monthly"
            }
          ]
        }
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: ":star: *Urgency* refers to how soon the task needs to be done (higher = schedule sooner).\n:trophy: *Importance* refers to the task's value and priority (higher = better time slots)."
          }
        ]
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: ":calendar: *Smart Scheduling*: The system will analyze your calendar to find the best available time slot that fits the task duration within your working hours, respecting existing appointments and prioritizing based on urgency/importance."
          }
        ]
      }
    ];
    
    // Add a simple sleep function for rate limiting
    const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    
    // Decide which token to use for sending the DM
    // If user token is provided, use it for better access permissions
    // Otherwise fall back to bot token
    const client = userToken ? createUserClient(userToken) : slack;
    console.log(`TASK DM: Using ${userToken ? 'user token' : 'bot token'} for sending DM`);
    
    // Maximum retry attempts
    const MAX_RETRIES = 3;
    // Exponential backoff delay (ms)
    const INITIAL_DELAY = 1000; // 1 second
    
    let retries = 0;
    let response;
    
    while (retries <= MAX_RETRIES) {
      try {
        response = await client.chat.postMessage({
          channel: slackUserId,
          text: `Task detected: ${extractedTitle}`,
          blocks,
          unfurl_links: false,
          unfurl_media: false
        });
        
        return response.ts;
      } catch (error: any) {
        // Enhanced error logging for debugging
        console.error('SLACK ERROR DETAILS:', {
          message: error.message || 'No error message',
          code: error.code || 'No error code',
          data: error.data || 'No error data',
          stack: error.stack || 'No stack trace'
        });
        
        if (error.data && error.data.error) {
          console.error(`SLACK API ERROR: ${error.data.error}`);
        }
        
        if (error.data && error.data.response_metadata) {
          console.error(`SLACK METADATA: ${JSON.stringify(error.data.response_metadata)}`);
        }
        
        // Check if the error is rate limiting related
        const isRateLimit = error.code === 'slack_webapi_platform_error' && 
                            error.data && error.data.error === 'ratelimited';
        
        retries++;
        
        if (isRateLimit && retries <= MAX_RETRIES) {
          // Get retry wait time from Slack or use exponential backoff
          const retryAfter = error.retryAfter || Math.pow(2, retries) * INITIAL_DELAY;
          console.log(`Rate limited. Retrying after ${retryAfter}ms (attempt ${retries} of ${MAX_RETRIES})`);
          await sleep(retryAfter);
        } else if (retries <= MAX_RETRIES) {
          // For other errors, use exponential backoff
          const backoffTime = Math.pow(2, retries) * INITIAL_DELAY;
          console.log(`Error sending message. Retrying after ${backoffTime}ms (attempt ${retries} of ${MAX_RETRIES})`);
          await sleep(backoffTime);
        } else {
          console.error('Error sending Slack task detection DM after max retries:', error);
          throw error;
        }
      }
    }
    
    // This line should never be reached due to return or throw in the loop
    return undefined;
  } catch (error) {
    console.error('Error in sendTaskDetectionDM:', error);
    return undefined;
  }
}

/**
 * Send a task suggestion to a user instead of creating a task directly
 * This allows the user to approve, modify, or reject the task
 * 
 * @param userId Slack user ID to send the message to
 * @param taskSuggestion Task suggestion details
 */
export async function sendTaskSuggestion(userId: string, taskSuggestion: {
  ts: string;
  channel: string;
  text: string;
  user: string;
  channelName: string;
  title: string;
  description: string;
  dueDate?: string;
  priority: string;
  timeRequired: string;
  urgency: number;
  importance: number;
  recurringPattern?: string;
  workspaceId?: number;
}) {
  try {
    console.log(`Sending task suggestion to user ${userId}`);
    
    // Format task information
    const taskInfo = {
      title: taskSuggestion.title,
      priority: taskSuggestion.priority,
      dueDate: taskSuggestion.dueDate || formatDateForSlack(new Date(Date.now() + 86400000)), // Default to tomorrow
      timeRequired: taskSuggestion.timeRequired || "1h",
      channelName: taskSuggestion.channelName || "a channel",
      messageTs: taskSuggestion.ts,
      channel: taskSuggestion.channel,
      description: taskSuggestion.description || taskSuggestion.text
    };
    
    // Create message blocks for the task suggestion
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:mag: *I detected a potential task for you*\n\nI found this message in #${taskInfo.channelName} that might be a task you need to handle.`
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `>${taskSuggestion.text.substring(0, 200)}${taskSuggestion.text.length > 200 ? '...' : ''}`
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Would you like me to add this as a task to your schedule?*"
        }
      },
      {
        type: "actions",
        block_id: "task_actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Provide Details and Schedule",
              emoji: true
            },
            style: "primary",
            value: JSON.stringify({
              action: "customize_task",
              messageTs: taskSuggestion.ts,
              channel: taskSuggestion.channel,
              messageText: taskSuggestion.text,
              channelName: taskSuggestion.channelName,
              title: taskSuggestion.title,
              description: taskSuggestion.description,
              dueDate: taskSuggestion.dueDate,
              priority: taskSuggestion.priority,
              timeRequired: taskSuggestion.timeRequired,
              urgency: taskSuggestion.urgency || 3,
              importance: taskSuggestion.importance || 3,
              workspaceId: taskSuggestion.workspaceId
            }),
            action_id: "customize_task"
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Ignore",
              emoji: true
            },
            style: "danger",
            value: JSON.stringify({
              action: "ignore_task",
              messageTs: taskSuggestion.ts,
              channel: taskSuggestion.channel,
              channelName: taskSuggestion.channelName
            }),
            action_id: "ignore_task"
          }
        ]
      }
    ];
    
    // Send the message using the bot token
    try {
      const response = await slack.chat.postMessage({
        channel: userId,
        text: `I detected a potential task: ${taskInfo.title}`,
        blocks
      });
      
      console.log(`Task suggestion sent successfully, timestamp: ${response.ts}`);
      return response;
    } catch (dmError) {
      console.error(`Error sending task suggestion to ${userId}:`, dmError);
      throw dmError;
    }
  } catch (error) {
    console.error('Error in sendTaskSuggestion:', error);
    throw error;
  }
}