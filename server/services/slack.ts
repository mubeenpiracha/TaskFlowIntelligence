import { WebClient } from '@slack/web-api';
import type { ConversationsHistoryResponse } from '@slack/web-api';

if (!process.env.SLACK_BOT_TOKEN) {
  console.warn("SLACK_BOT_TOKEN environment variable is not set - Slack integration will not work");
}

// Initialize the Slack WebClient with the bot token
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
 * Lists all channels that the authenticated user (bot) is a member of
 * @returns Promise with list of channels
 */
export async function listUserChannels(): Promise<SlackChannel[]> {
  try {
    // Get all public channels the bot is a member of
    const publicResult = await slack.conversations.list({
      types: 'public_channel',
      exclude_archived: true,
      limit: 1000
    });

    // Get all private channels the bot is a member of
    const privateResult = await slack.conversations.list({
      types: 'private_channel',
      exclude_archived: true,
      limit: 1000
    });

    // Combine and filter channels to include only those the bot is a member of
    const allChannels = [
      ...(publicResult.channels || []),
      ...(privateResult.channels || [])
    ] as any[];

    // Map to our expected format
    return allChannels
      .filter(channel => channel.is_member)
      .map(channel => ({
        id: channel.id,
        name: channel.name,
        is_member: channel.is_member,
        is_private: channel.is_private,
        is_channel: true,
        num_members: channel.num_members
      }));
  } catch (error) {
    console.error('Error listing Slack channels:', error);
    return [];
  }
}

/**
 * Gets user info from Slack
 * @param userId - Slack user ID
 * @returns Promise with user information
 */
export async function getUserInfo(userId: string) {
  try {
    const result = await slack.users.info({ user: userId });
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
 * @returns Promise resolving to the messages
 */
export async function readChannelHistory(
  channelId: string,
  messageLimit: number = 100
): Promise<SlackMessage[]> {
  try {
    // Get messages
    const result = await slack.conversations.history({
      channel: channelId,
      limit: messageLimit,
    });

    // For each message, get the user profile
    const messages = await Promise.all((result.messages || []).map(async (message: any) => {
      let userProfile = null;
      if (message.user) {
        const userInfo = await getUserInfo(message.user);
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
 * @returns Promise with detected task messages, merged from all channels
 */
export async function detectTasks(channelIds: string[], userId: string): Promise<SlackMessage[]> {
  try {
    // Get channel names for better context
    const allChannels = await listUserChannels();
    const channelMap = new Map<string, string>();
    allChannels.forEach(channel => channelMap.set(channel.id, channel.name));
    
    // Process all channels in parallel
    const channelPromises = channelIds.map(async (channelId) => {
      const messages = await readChannelHistory(channelId);
      
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
 * @returns Promise resolving to the message timestamp
 */
export async function sendMessage(
  channelId: string,
  text: string,
  blocks?: any[]
) {
  try {
    const response = await slack.chat.postMessage({
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