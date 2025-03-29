import { WebClient } from '@slack/web-api';
import type { ConversationsHistoryResponse } from '@slack/web-api';
import { extractTaskTitle, extractDueDate, determinePriority, estimateTimeRequired } from './taskCreation';

if (!process.env.SLACK_BOT_TOKEN) {
  console.warn("SLACK_BOT_TOKEN environment variable is not set - Slack bot operations will not work");
}

// Initialize the Slack WebClient with the bot token for bot-only operations
// This will be used as a fallback when user token is not available
const slack = new WebClient(process.env.SLACK_BOT_TOKEN || '');

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
}

/**
 * Lists all channels that the authenticated user is a member of
 * @param userToken - User token (xoxp-) to use for listing channels
 * @returns Promise with list of channels
 */
export async function listUserChannels(userToken?: string): Promise<SlackChannel[]> {
  // For this operation, we strongly prefer to use a user token
  // Bot token is very limited and can only see channels the bot was invited to
  if (!userToken) {
    console.warn('No user token provided for listUserChannels. This may result in incomplete channel list.');
  }
  
  const token = userToken || process.env.SLACK_BOT_TOKEN;
  
  if (!token || token.trim() === '') {
    console.error('Slack token is missing or empty');
    throw new Error('Slack token is missing or empty. Please check your environment variables or user credentials.');
  }
  
  // Create a client with the appropriate token
  const client = new WebClient(token);
  
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
    
    // If we have a user token, we can get all types of conversations
    const conversationTypes = userToken
      ? 'public_channel,private_channel,mpim,im' // User token can access all types
      : 'public_channel'; // Bot token without user context is very limited
    
    // Get conversations the user is a member of
    const result = await client.users.conversations({
      types: conversationTypes,
      exclude_archived: true,
      limit: 1000
    });
    
    // Map to our expected format
    return (result.channels || [])
      .filter((channel: any) => {
        // Filter out non-channel results if needed
        return channel.is_channel !== false && channel.is_im !== true;
      })
      .map((channel: any) => ({
        id: channel.id,
        name: channel.name || `DM with ${channel.user || 'Unknown'}`,
        is_member: true, // users.conversations only returns channels the user is a member of
        is_private: channel.is_private || false,
        is_channel: channel.is_channel !== false,
        num_members: channel.num_members
      }));
  } catch (error) {
    console.error('Error listing Slack channels:', error);
    // Re-throw so the route handler can deal with it appropriately
    throw error;
  }
}

/**
 * Gets user info from Slack
 * @param userId - Slack user ID
 * @param userToken - Optional user token to use instead of bot token
 * @returns Promise with user information
 */
export async function getUserInfo(userId: string, userToken?: string) {
  // Create a client with the appropriate token
  const client = userToken ? new WebClient(userToken) : slack;
  
  try {
    const result = await client.users.info({ user: userId });
    return result.user;
  } catch (error) {
    console.error('Error getting user info:', error);
    return null;
  }
}

/**
 * Reads the history of messages in a channel
 * @param channelId - Channel ID to read message history from
 * @param messageLimit - Maximum number of messages to retrieve
 * @param userToken - Optional user token to use instead of bot token
 * @returns Promise resolving to the messages
 */
export async function readChannelHistory(
  channelId: string,
  messageLimit: number = 100,
  userToken?: string
): Promise<SlackMessage[]> {
  // Create a client with the appropriate token
  const client = userToken ? new WebClient(userToken) : slack;
  
  try {
    // Get messages
    const result = await client.conversations.history({
      channel: channelId,
      limit: messageLimit,
    });

    // For each message, get the user profile
    const messages = await Promise.all((result.messages || []).map(async (message: any) => {
      let userProfile = null;
      if (message.user) {
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
    return [];
  }
}

/**
 * Analyzes a message to determine if it might contain a task
 * Uses simple heuristics to detect potential tasks
 * @param message - The message text to analyze
 * @param userId - User ID to check for mentions
 * @returns Boolean indicating if the message likely contains a task
 */
function isLikelyTask(message: string, userId: string): boolean {
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
  
  // Check if message contains task keywords
  const containsTaskKeyword = taskKeywords.some(keyword => 
    message.toLowerCase().includes(keyword.toLowerCase())
  );
  
  // Simple heuristic: Message is likely a task if it mentions the user AND contains task keywords
  // OR if it has very strong task indicators (e.g., "TODO", "deadline", "ASAP")
  const strongTaskIndicators = ['todo', 'deadline', 'asap', 'due', 'urgent'];
  const hasStrongIndicator = strongTaskIndicators.some(keyword => 
    message.toLowerCase().includes(keyword.toLowerCase())
  );
  
  return (containsMention && containsTaskKeyword) || hasStrongIndicator;
}

/**
 * Detects potential tasks in Slack messages across multiple channels
 * @param channelIds - Array of channel IDs to analyze
 * @param userId - User ID to look for mentions of
 * @param userToken - Optional user token to use instead of bot token
 * @returns Promise with detected task messages, merged from all channels
 */
export async function detectTasks(channelIds: string[], userId: string, userToken?: string): Promise<SlackMessage[]> {
  try {
    // Get channel names for better context
    const allChannels = await listUserChannels(userToken);
    const channelMap = new Map<string, string>();
    allChannels.forEach(channel => channelMap.set(channel.id, channel.name));
    
    // Process all channels in parallel
    const channelPromises = channelIds.map(async (channelId) => {
      const messages = await readChannelHistory(channelId, 100, userToken);
      
      // Filter messages to those that likely contain tasks
      const taskMessages = messages.filter(msg => isLikelyTask(msg.text, userId));
      
      // Add channel name to each message for context
      return taskMessages.map(msg => ({
        ...msg,
        channelName: channelMap.get(msg.channelId || '') || 'unknown-channel'
      }));
    });
    
    // Merge all results
    const results = await Promise.all(channelPromises);
    return results.flat();
  } catch (error) {
    console.error('Error detecting tasks in Slack:', error);
    return [];
  }
}

/**
 * Sends a structured message to a Slack channel
 * @param channelId - Channel ID to send message to
 * @param text - Message text
 * @param blocks - Optional structured message blocks
 * @param userToken - Optional user token to use instead of bot token
 * @returns Promise resolving to the message timestamp
 */
export async function sendMessage(
  channelId: string,
  text: string,
  blocks?: any[],
  userToken?: string
) {
  // Create a client with the appropriate token
  const client = userToken ? new WebClient(userToken) : slack;
  
  try {
    const response = await client.chat.postMessage({
      channel: channelId,
      text,
      blocks,
      unfurl_links: false,
      unfurl_media: false
    });
    
    return response.ts;
  } catch (error) {
    console.error('Error sending Slack message:', error);
    throw error;
  }
}

/**
 * Sends an interactive message to a user with task details and action buttons
 * @param slackUserId - Slack user ID to send the DM to
 * @param message - The detected Slack message that contains a potential task
 * @param userToken - Optional user token to use instead of bot token
 * @returns Promise resolving to the message timestamp
 */
export async function sendTaskDetectionDM(
  slackUserId: string,
  message: SlackMessage,
  userToken?: string
): Promise<string | undefined> {
  try {
    // Extract initial task information
    const extractedTitle = extractTaskTitle(message.text);
    const extractedDueDate = extractDueDate(message.text);
    const initialPriority = determinePriority(message.text);
    const initialTimeRequired = estimateTimeRequired(message.text);
    
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
          text: "*Would you like me to create a task from this message?*"
        }
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Yes, create task",
              emoji: true
            },
            style: "primary",
            value: JSON.stringify({
              action: "create_task",
              ts: message.ts,
              text: message.text,
              user: message.user,
              channelId: message.channelId,
              channelName: message.channelName,
              title: extractedTitle,
              priority: initialPriority,
              timeRequired: initialTimeRequired,
              dueDate: extractedDueDate?.dueDate,
              dueTime: extractedDueDate?.dueTime
            }),
            action_id: "create_task"
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "No, ignore",
              emoji: true
            },
            value: JSON.stringify({
              action: "ignore_task",
              ts: message.ts
            }),
            action_id: "ignore_task"
          }
        ]
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "*Task details*"
        }
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Title*\n${extractedTitle}`
          },
          {
            type: "mrkdwn",
            text: `*Priority*\n${
              initialPriority === 'high' ? ':red_circle: High' :
              initialPriority === 'medium' ? ':large_yellow_circle: Medium' :
              ':large_green_circle: Low'
            }`
          },
          {
            type: "mrkdwn",
            text: `*Due*\n${extractedDueDate ? 
              `${extractedDueDate.dueDate}${extractedDueDate.dueTime ? ` at ${extractedDueDate.dueTime}` : ''}` : 
              'No due date detected'}`
          },
          {
            type: "mrkdwn",
            text: `*Estimated time*\n${initialTimeRequired}`
          }
        ]
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Edit details",
              emoji: true
            },
            value: JSON.stringify({
              action: "edit_task",
              ts: message.ts,
              text: message.text,
              user: message.user,
              channelId: message.channelId,
              channelName: message.channelName,
              title: extractedTitle,
              priority: initialPriority,
              timeRequired: initialTimeRequired,
              dueDate: extractedDueDate?.dueDate,
              dueTime: extractedDueDate?.dueTime
            }),
            action_id: "edit_task_details"
          }
        ]
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Tasks you create will be added to your TaskFlow dashboard and scheduled in your calendar if connected."
          }
        ]
      }
    ];
    
    // Send the DM
    return await sendMessage(
      slackUserId,
      `Task detected: ${extractedTitle}`,
      blocks,
      userToken
    );
  } catch (error) {
    console.error('Error sending task detection DM to Slack:', error);
    return undefined;
  }
}