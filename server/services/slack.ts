import { WebClient } from '@slack/web-api';
import type { ConversationsHistoryResponse } from '@slack/web-api';
import { extractTaskTitle, extractDueDate, determinePriority, estimateTimeRequired } from './taskCreation';

if (!process.env.SLACK_BOT_TOKEN) {
  console.warn("SLACK_BOT_TOKEN environment variable is not set - Slack bot operations will not work");
}

// Initialize the Slack WebClient with the bot token for bot-only operations
// This will be used as a fallback when user token is not available
export const slack = new WebClient(process.env.SLACK_BOT_TOKEN || '');

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
                // Pass the full message object to enable AI-powered detection
                const result = await isLikelyTask(msg.text, userId, msg);
                
                // Extra logging with timestamp for easy correlation in logs
                console.log(`DETECTION RESULT [${msg.ts}]: ${result ? 'IS TASK' : 'NOT TASK'}`);
                
                // Only return the message if it's a task
                if (result) {
                  return msg;
                } else {
                  return null;
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
 * @returns Promise resolving to the message timestamp
 */
export async function sendTaskDetectionDM(
  slackUserId: string,
  message: SlackMessage
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
              ts: message.ts,
              channelId: message.channelId,
              channelName: message.channelName
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
            action_id: "edit_task"
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
    
    // Add a simple sleep function for rate limiting
    const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
    
    // Send the DM using the bot token
    // For task notifications, we always use the bot token
    // This keeps a consistent identity for task-related communications
    const client = slack; // Use the global slack client with bot token
    
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