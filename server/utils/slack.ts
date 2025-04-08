import { type ChatPostMessageArguments, WebClient } from "@slack/web-api";

if (!process.env.SLACK_BOT_TOKEN) {
  console.warn("SLACK_BOT_TOKEN environment variable not set - Slack integration will be unavailable");
}

const slack = process.env.SLACK_BOT_TOKEN ? new WebClient(process.env.SLACK_BOT_TOKEN) : null;

interface SlackChannel {
  id: string;
  name: string;
  is_member: boolean;
  is_private: boolean;
  is_mpim?: boolean;
  is_im?: boolean;
  is_channel: boolean;
  num_members?: number;
}

/**
 * Sends a structured message to a Slack channel using the Slack Web API
 * @param message - Structured message to send
 * @returns Promise resolving to the sent message's timestamp
 */
async function sendSlackMessage(
  message: ChatPostMessageArguments
): Promise<string | undefined> {
  if (!slack) {
    throw new Error("Slack client not initialized - check SLACK_BOT_TOKEN environment variable");
  }
  
  try {
    // Send the message
    const response = await slack.chat.postMessage(message);
    return response.ts;
  } catch (error) {
    console.error('Error sending Slack message:', error);
    throw error;
  }
}

/**
 * Reads the history of a channel
 * @param channelId - Channel ID to read message history from
 * @param messageLimit - Maximum number of messages to retrieve
 * @returns Promise resolving to the messages
 */
async function readSlackHistory(
  channelId: string,
  messageLimit: number = 100,
) {
  if (!slack) {
    throw new Error("Slack client not initialized - check SLACK_BOT_TOKEN environment variable");
  }
  
  try {
    return await slack.conversations.history({
      channel: channelId,
      limit: messageLimit,
    });
  } catch (error) {
    console.error('Error reading Slack history:', error);
    throw error;
  }
}

/**
 * Gets user info from Slack
 * @param userId - Slack user ID
 * @returns Promise with user information
 */
async function getUserInfo(userId: string) {
  if (!slack) {
    throw new Error("Slack client not initialized - check SLACK_BOT_TOKEN environment variable");
  }
  
  try {
    return await slack.users.info({
      user: userId
    });
  } catch (error) {
    console.error('Error getting Slack user info:', error);
    throw error;
  }
}

/**
 * Lists all channels that the authenticated user is a member of
 * @returns Promise with list of channels
 */
async function listUserChannels(): Promise<SlackChannel[]> {
  if (!slack) {
    throw new Error("Slack client not initialized - check SLACK_BOT_TOKEN environment variable");
  }
  
  try {
    // Get all channels (public and private) that the bot is in
    const result = await slack.users.conversations({
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: 1000
    });
    
    if (!result.channels || result.channels.length === 0) {
      return [];
    }
    
    // Format and return the channels
    return result.channels.map((channel: any) => ({
      id: channel.id,
      name: channel.name,
      is_member: channel.is_member || false,
      is_private: channel.is_private || false,
      is_channel: channel.is_channel || false,
      num_members: channel.num_members
    }));
  } catch (error) {
    console.error('Error listing Slack channels:', error);
    throw error;
  }
}

/**
 * Detects potential tasks in Slack messages across multiple channels
 * @param channelIds - Array of channel IDs to analyze
 * @param userId - User ID to look for mentions of
 * @returns Promise with detected task messages, merged from all channels
 */
async function detectTasks(channelIds: string[] | string, userId: string) {
  if (!slack) {
    throw new Error("Slack client not initialized - check SLACK_BOT_TOKEN environment variable");
  }
  
  try {
    // If we received a single channel ID as a string, convert to array
    const channels = Array.isArray(channelIds) ? channelIds : [channelIds];
    
    // If no channels specified but we have a default, use that
    if (channels.length === 0 && process.env.SLACK_CHANNEL_ID) {
      channels.push(process.env.SLACK_CHANNEL_ID);
    }
    
    // If still no channels to monitor, return empty array
    if (channels.length === 0) {
      return [];
    }
    
    // Process each channel and gather all potential tasks
    const allTasks = [];
    
    for (const channelId of channels) {
      try {
        const history = await readSlackHistory(channelId);
        
        // Get channel info to include channel name
        const channelInfo = await slack.conversations.info({ channel: channelId });
        const channelName = channelInfo?.channel?.name || channelId;
        
        // Filter messages that mention the user and might be tasks
        const detectedTasks = history.messages?.filter(message => {
          // Check if the message contains a mention of the user
          const userMention = `<@${userId}>`;
          if (!message.text?.includes(userMention)) return false;
          
          console.log(`TASK_DETECTION: Analyzing message in ${channelName} (${message.ts}): "${message.text?.slice(0, 50)}${message.text?.length > 50 ? '...' : ''}"`);
          
          // Look for task-like language
          const taskKeywords = ['can you', 'please', 'need', 'todo', 'to-do', 'task', 'by', 'due', 'deadline'];
          
          // Log which keywords are found
          const foundKeywords = taskKeywords.filter(keyword => message.text?.toLowerCase().includes(keyword));
          
          if (foundKeywords.length > 0) {
            console.log(`TASK_DETECTION: Found keywords [${foundKeywords.join(', ')}] in message: "${message.text?.slice(0, 50)}${message.text?.length > 50 ? '...' : ''}"`);
            return true;
          }
          
          console.log(`TASK_DETECTION: No task keywords found in message: "${message.text?.slice(0, 50)}${message.text?.length > 50 ? '...' : ''}"`);
          return false;
        }).map(message => ({
          ...message,
          channel: channelId,
          channel_name: channelName
        }));
        
        if (detectedTasks && detectedTasks.length > 0) {
          allTasks.push(...detectedTasks);
        }
      } catch (error) {
        console.error(`Error processing channel ${channelId}:`, error);
        // Continue with other channels even if one fails
      }
    }
    
    // Enhance with user profiles
    for (const task of allTasks) {
      try {
        if (task.user) {
          const userInfo = await getUserInfo(task.user);
          if (userInfo.user?.profile) {
            task.user_profile = userInfo.user.profile;
          }
        }
      } catch (error) {
        console.error(`Error fetching profile for user ${task.user}:`, error);
      }
    }
    
    return allTasks;
  } catch (error) {
    console.error('Error detecting tasks from Slack:', error);
    throw error;
  }
}

export { sendSlackMessage, readSlackHistory, detectTasks, listUserChannels, getUserInfo, type SlackChannel };
