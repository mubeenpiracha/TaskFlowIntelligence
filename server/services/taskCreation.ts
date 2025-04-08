import { storage } from '../storage';
import { sendMessage, slack, getUserTimezone } from './slack';
import { createCalendarEvent } from './google';
import { notifyTaskDetection } from './websocket';
import type { SlackMessage } from '../services/slack';
import type { Task, InsertTask } from '@shared/schema';

/**
 * Extracts a task title from a Slack message text
 * This is a simple extraction based on common patterns
 * A more sophisticated implementation might use AI/NLP
 * @param messageText - The message text to parse
 * @returns Extracted task title
 */
export function extractTaskTitle(messageText: string): string {
  console.log(`TITLE_EXTRACTION: Original message: "${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}"`);
  
  // Remove any user mentions like <@U12345678>
  let cleanText = messageText.replace(/<@[A-Z0-9]+>/g, '').trim();
  console.log(`TITLE_EXTRACTION: After removing mentions: "${cleanText.substring(0, 100)}${cleanText.length > 100 ? '...' : ''}"`);
  
  // If the text is too long, truncate it
  if (cleanText.length > 100) {
    cleanText = cleanText.substring(0, 97) + '...';
    console.log(`TITLE_EXTRACTION: Truncated title: "${cleanText}"`);
  }
  
  console.log(`TITLE_EXTRACTION: Final extracted title: "${cleanText}"`);
  return cleanText;
}

/**
 * Attempts to extract due date information from a message
 * Uses simple pattern matching for common date formats
 * @param messageText - The message text to analyze
 * @returns Object with extracted date or null if none found
 */
export function extractDueDate(messageText: string): { dueDate: string, dueTime: string } | null {
  console.log(`DUE_DATE_EXTRACTION: Analyzing message for due dates: "${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}"`);
  
  // This is a simplified implementation
  // Look for patterns like "by tomorrow", "due Friday", etc.
  const text = messageText.toLowerCase();
  const today = new Date();
  console.log(`DUE_DATE_EXTRACTION: Today's date is ${today.toISOString().split('T')[0]}`);
  
  // Default time is end of workday
  const dueTime = '17:00';
  
  // Check for "today"
  if (text.includes('today') || text.includes('by end of day') || text.includes('by eod')) {
    console.log(`DUE_DATE_EXTRACTION: Found 'today' or 'end of day' reference`);
    const result = {
      dueDate: today.toISOString().split('T')[0],
      dueTime
    };
    console.log(`DUE_DATE_EXTRACTION: Due date set to today: ${result.dueDate} at ${result.dueTime}`);
    return result;
  }
  
  // Check for "tomorrow"
  if (text.includes('tomorrow')) {
    console.log(`DUE_DATE_EXTRACTION: Found 'tomorrow' reference`);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const result = {
      dueDate: tomorrow.toISOString().split('T')[0],
      dueTime
    };
    console.log(`DUE_DATE_EXTRACTION: Due date set to tomorrow: ${result.dueDate} at ${result.dueTime}`);
    return result;
  }
  
  // Check for "next week"
  if (text.includes('next week')) {
    console.log(`DUE_DATE_EXTRACTION: Found 'next week' reference`);
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const result = {
      dueDate: nextWeek.toISOString().split('T')[0],
      dueTime
    };
    console.log(`DUE_DATE_EXTRACTION: Due date set to next week: ${result.dueDate} at ${result.dueTime}`);
    return result;
  }
  
  // Check for day names (e.g., "by Monday", "due Friday")
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < dayNames.length; i++) {
    if (text.includes(dayNames[i]) || text.includes(dayNames[i].substring(0, 3))) {
      console.log(`DUE_DATE_EXTRACTION: Found day name reference: ${dayNames[i]}`);
      
      const targetDay = i;
      const currentDay = today.getDay();
      let daysToAdd = targetDay - currentDay;
      
      console.log(`DUE_DATE_EXTRACTION: Current day is ${dayNames[currentDay]}, target day is ${dayNames[targetDay]}`);
      console.log(`DUE_DATE_EXTRACTION: Initial calculation: ${daysToAdd} days to add`);
      
      // If the day has already passed this week, go to next week
      if (daysToAdd <= 0) {
        daysToAdd += 7;
        console.log(`DUE_DATE_EXTRACTION: Day already passed, adding a week: ${daysToAdd} days to add`);
      }
      
      const dueDate = new Date(today);
      dueDate.setDate(dueDate.getDate() + daysToAdd);
      
      const result = {
        dueDate: dueDate.toISOString().split('T')[0],
        dueTime
      };
      console.log(`DUE_DATE_EXTRACTION: Due date set to ${dayNames[i]}: ${result.dueDate} at ${result.dueTime}`);
      return result;
    }
  }
  
  // No specific date found, default to tomorrow
  console.log(`DUE_DATE_EXTRACTION: No specific date reference found, defaulting to tomorrow`);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const result = {
    dueDate: tomorrow.toISOString().split('T')[0],
    dueTime
  };
  console.log(`DUE_DATE_EXTRACTION: Default due date: ${result.dueDate} at ${result.dueTime}`);
  return result;
}

/**
 * Determines a task's priority based on message content
 * @param messageText - The message text to analyze
 * @returns Priority level (high, medium, low)
 */
export function determinePriority(messageText: string): 'high' | 'medium' | 'low' {
  console.log(`PRIORITY_DETECTION: Analyzing message for priority indicators: "${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}"`);
  
  const text = messageText.toLowerCase();
  
  // Define priority indicators
  const highPriorityIndicators = [
    'urgent', 'asap', 'as soon as possible', 'important', 'critical', 'right away', 'emergency'
  ];
  
  const lowPriorityIndicators = [
    'low priority', 'when you have time', 'no rush', 'eventually', 'non-urgent', 'not urgent'
  ];
  
  // Check for high priority indicators
  const highPriorityMatches = highPriorityIndicators.filter(indicator => text.includes(indicator));
  if (highPriorityMatches.length > 0) {
    console.log(`PRIORITY_DETECTION: Found high priority indicators: ${highPriorityMatches.join(', ')}`);
    return 'high';
  }
  
  // Check for low priority indicators
  const lowPriorityMatches = lowPriorityIndicators.filter(indicator => text.includes(indicator));
  if (lowPriorityMatches.length > 0) {
    console.log(`PRIORITY_DETECTION: Found low priority indicators: ${lowPriorityMatches.join(', ')}`);
    return 'low';
  }
  
  // Default to medium priority
  console.log(`PRIORITY_DETECTION: No clear priority indicators found, defaulting to medium priority`);
  return 'medium';
}

/**
 * Estimates time required for a task based on message content
 * Uses simple heuristics or falls back to a default
 * @param messageText - The message text to analyze
 * @returns Estimated time required in HH:MM format
 */
export function estimateTimeRequired(messageText: string): string {
  console.log(`TIME_ESTIMATION: Analyzing message for time requirements: "${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}"`);
  
  const text = messageText.toLowerCase();
  
  // Check for explicit time mentions (e.g., "takes 30 minutes", "2 hours")
  const hourPattern = /(\d+)\s*(hour|hr|hrs|hours)/i;
  const minutePattern = /(\d+)\s*(minute|min|mins|minutes)/i;
  
  console.log(`TIME_ESTIMATION: Searching for hour pattern: ${hourPattern}`);
  const hourMatch = text.match(hourPattern);
  
  console.log(`TIME_ESTIMATION: Searching for minute pattern: ${minutePattern}`);
  const minuteMatch = text.match(minutePattern);
  
  let hours = 0;
  let minutes = 0;
  
  if (hourMatch) {
    console.log(`TIME_ESTIMATION: Found hour match: ${hourMatch[0]}`);
    hours = parseInt(hourMatch[1], 10);
    console.log(`TIME_ESTIMATION: Extracted hours: ${hours}`);
  }
  
  if (minuteMatch) {
    console.log(`TIME_ESTIMATION: Found minute match: ${minuteMatch[0]}`);
    minutes = parseInt(minuteMatch[1], 10);
    console.log(`TIME_ESTIMATION: Extracted minutes: ${minutes}`);
  }
  
  // If we found explicit time mention
  if (hours > 0 || minutes > 0) {
    // Convert to hours:minutes format
    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
    console.log(`TIME_ESTIMATION: Using explicitly mentioned time: ${timeStr}`);
    return timeStr;
  }
  
  // Default estimates based on message length and complexity
  console.log(`TIME_ESTIMATION: No explicit time found, estimating based on message length (${text.length} chars)`);
  let timeStr;
  
  if (text.length < 50) {
    timeStr = '00:30'; // 30 minutes for short tasks
    console.log(`TIME_ESTIMATION: Short message (<50 chars), estimating ${timeStr}`);
  } else if (text.length < 200) {
    timeStr = '01:00'; // 1 hour for medium tasks
    console.log(`TIME_ESTIMATION: Medium message (<200 chars), estimating ${timeStr}`);
  } else {
    timeStr = '02:00'; // 2 hours for longer tasks
    console.log(`TIME_ESTIMATION: Long message (≥200 chars), estimating ${timeStr}`);
  }
  
  return timeStr;
}

/**
 * Creates a task from a Slack message
 * @param message - The Slack message, with optional custom parameters
 * @param userId - The user ID to associate the task with
 * @returns The created task
 */
export async function createTaskFromSlackMessage(
  message: SlackMessage & {
    customTitle?: string;
    customDescription?: string;
    customPriority?: 'high' | 'medium' | 'low';
    customTimeRequired?: string;
    customDueDate?: string;
    customDueTime?: string;
    customUrgency?: number;
    customImportance?: number;
    scheduledStart?: string;
    scheduledEnd?: string;
  }, 
  userId: number
): Promise<Task> {
  try {
    console.log('Creating task from Slack message with ID:', message.ts);
    
    if (!message.ts) {
      throw new Error('Invalid Slack message: missing timestamp (ts)');
    }
    
    if (!message.text) {
      throw new Error('Invalid Slack message: missing text content');
    }
    
    // Check if a task already exists for this message
    console.log('Checking for existing task with Slack message ID:', message.ts);
    const existingTask = await storage.getTasksBySlackMessageId(message.ts);
    if (existingTask) {
      console.log('Found existing task:', existingTask.id);
      return existingTask;
    }
    
    console.log('=================== TASK ANALYSIS ===================');
    console.log(`TASK_ANALYSIS: Analyzing message (${message.ts}): "${message.text.slice(0, 100)}${message.text.length > 100 ? '...' : ''}"`);
    
    // Extract information from the message, or use provided custom values
    let title;
    if (message.customTitle) {
      title = message.customTitle;
      console.log(`TASK_ANALYSIS: Using custom title: "${title}"`);
    } else {
      title = extractTaskTitle(message.text);
      console.log(`TASK_ANALYSIS: Extracted title: "${title}"`);
    }
    
    const description = message.customDescription || message.text;
    console.log(`TASK_ANALYSIS: Using description (${description.length} chars): "${description.slice(0, 50)}${description.length > 50 ? '...' : ''}"`);
    
    let priority;
    if (message.customPriority) {
      priority = message.customPriority;
      console.log(`TASK_ANALYSIS: Using custom priority: ${priority}`);
    } else {
      priority = determinePriority(message.text);
      console.log(`TASK_ANALYSIS: Determined priority: ${priority}`);
    }
    
    let timeRequired;
    if (message.customTimeRequired) {
      timeRequired = message.customTimeRequired;
      console.log(`TASK_ANALYSIS: Using custom time required: ${timeRequired}`);
    } else {
      timeRequired = estimateTimeRequired(message.text);
      console.log(`TASK_ANALYSIS: Estimated time required: ${timeRequired}`);
    }
    
    // Use custom date/time if provided, otherwise extract from message
    let dueDate: string | null = null;
    let dueTime: string | null = null;
    
    if (message.customDueDate) {
      console.log(`TASK_ANALYSIS: Using custom due date: ${message.customDueDate}`);
      dueDate = message.customDueDate;
      dueTime = message.customDueTime || null;
      if (dueTime) {
        console.log(`TASK_ANALYSIS: Using custom due time: ${dueTime}`);
      }
    } else {
      console.log('TASK_ANALYSIS: Attempting to extract due date from message text');
      const extractedDueDate = extractDueDate(message.text);
      if (extractedDueDate) {
        dueDate = extractedDueDate.dueDate;
        dueTime = extractedDueDate.dueTime;
        console.log(`TASK_ANALYSIS: Extracted due date: ${dueDate} at ${dueTime}`);
      } else {
        console.log('TASK_ANALYSIS: No due date found in message');
      }
    }
    console.log('=================== END TASK ANALYSIS ===================');
    
    // Create task object
    const taskData: InsertTask = {
      userId,
      title,
      description,
      priority,
      timeRequired,
      dueDate,
      dueTime,
      completed: false,
      slackMessageId: message.ts,
      slackChannelId: message.channelId || null,
      googleEventId: null,
      urgency: message.customUrgency || null,
      importance: message.customImportance || null,
      scheduledStart: message.scheduledStart || null,
      scheduledEnd: message.scheduledEnd || null
    };
    
    // Create the task in storage
    const createdTask = await storage.createTask(taskData);
    
    // Send real-time notification via WebSocket
    notifyTaskDetection(userId, createdTask);
    
    // Check if user has Google Calendar connected and create calendar event
    const user = await storage.getUser(userId);
    if (user?.googleRefreshToken && createdTask.dueDate && createdTask.dueTime) {
      try {
        // Calculate end time based on time required
        const [dueHours, dueMinutes] = createdTask.dueTime.split(':').map(Number);
        const [reqHours, reqMinutes] = (createdTask.timeRequired || '01:00').split(':').map(Number);
        
        const startDate = new Date(`${createdTask.dueDate}T${createdTask.dueTime}`);
        
        // For backward scheduling, we calculate the start time by subtracting the duration from the due time
        startDate.setHours(startDate.getHours() - reqHours);
        startDate.setMinutes(startDate.getMinutes() - reqMinutes);
        
        const endDate = new Date(`${createdTask.dueDate}T${createdTask.dueTime}`);
        
        // Get user's timezone from Slack if available
        let userTimeZone = 'UTC';
        if (user.slackUserId) {
          try {
            const { timezone } = await getUserTimezone(user.slackUserId);
            userTimeZone = timezone;
            console.log(`Using user's Slack timezone: ${userTimeZone}`);
          } catch (err) {
            console.error('Error getting user timezone from Slack, falling back to UTC:', err);
          }
        }
        
        // Create an event on the user's calendar
        const event = await createCalendarEvent(
          user.googleRefreshToken,
          {
            summary: `Task: ${createdTask.title}`,
            description: createdTask.description || '',
            start: {
              dateTime: startDate.toISOString(),
              timeZone: userTimeZone
            },
            end: {
              dateTime: endDate.toISOString(),
              timeZone: userTimeZone
            },
            colorId: priority === 'high' ? '4' : priority === 'medium' ? '5' : '6', // Red, Yellow, Green
          }
        );
        
        // Store the Google Calendar event ID with the task
        if (event?.id) {
          await storage.updateTask(createdTask.id, { googleEventId: event.id });
        }
      } catch (error) {
        console.error('Error creating Google Calendar event:', error);
        // Continue without calendar event if there's an error
      }
    }
    
    return createdTask;
  } catch (error) {
    console.error('Error creating task from Slack message:', error);
    throw error;
  }
}

/**
 * Sends a confirmation message back to the Slack channel or as a direct message to the user
 * about a task that was created from a message
 * @param task - The task that was created
 * @param channelId - The Slack channel ID to reply to, or the user ID to DM
 * @param sendAsDM - Whether to send as a direct message to the user instead of in the channel
 * @returns The timestamp of the sent message
 */
export async function sendTaskConfirmation(
  task: Task, 
  channelId: string, 
  sendAsDM: boolean = true
): Promise<string | undefined> {
  try {
    console.log(`Sending task confirmation for task ID ${task.id} to ${sendAsDM ? 'user DM' : 'channel'}`);
    
    // Validate task data
    if (!task || !task.id) {
      throw new Error('Invalid task object provided to sendTaskConfirmation');
    }
    
    // Format the message nicely with task details
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:white_check_mark: *Task created successfully*\n\nI've added this to your task list.`
        }
      },
      {
        type: "divider"
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Task*\n${task.title || 'Untitled Task'}`
          },
          {
            type: "mrkdwn",
            text: `*Priority*\n${
              task.priority === 'high' ? ':red_circle: High' :
              task.priority === 'medium' ? ':large_yellow_circle: Medium' :
              ':large_green_circle: Low'
            }`
          },
          {
            type: "mrkdwn",
            text: `*Due*\n${task.dueDate ? `${task.dueDate}${task.dueTime ? ` at ${task.dueTime}` : ''}` : 'No due date'}`
          },
          {
            type: "mrkdwn",
            text: `*Estimated time*\n${task.timeRequired || '1 hour'}`
          }
        ]
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Importance*\n${task.importance ? `${task.importance}/5` : 'Not specified'}`
          },
          {
            type: "mrkdwn",
            text: `*Urgency*\n${task.urgency ? `${task.urgency}/5` : 'Not specified'}`
          },
          {
            type: "mrkdwn",
            text: `*Scheduled*\n${
              task.scheduledStart && task.scheduledEnd
                ? `${new Date(task.scheduledStart).toLocaleString('en-US', { 
                    month: 'short', 
                    day: 'numeric', 
                    hour: 'numeric', 
                    minute: '2-digit',
                    hour12: true
                  })} - ${new Date(task.scheduledEnd).toLocaleString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                  })}`
                : 'Not scheduled yet'
            }`
          }
        ]
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `You can manage this task in your TaskFlow dashboard.`
          }
        ]
      }
    ];
    
    // Get the user ID if available (for sending a DM)
    console.log(`Fetching user with ID ${task.userId} for DM confirmation`);
    const user = await storage.getUser(task.userId);
    
    if (!user) {
      console.error(`User with ID ${task.userId} not found for task confirmation`);
    }
    
    if (sendAsDM && !user?.slackUserId) {
      console.warn(`Cannot send DM: User ${task.userId} has no Slack ID, will send to channel`);
    }
    
    // If sendAsDM is true and we have a Slack user ID, send as DM
    const targetId = sendAsDM && user?.slackUserId 
      ? user.slackUserId  // Send to user's DM
      : channelId;        // Send to original channel
    
    console.log(`Sending confirmation message to target ID: ${targetId}`);
    
    // Send the confirmation message using the bot token
    // For task confirmations, we always use the bot token for consistent branding
    // and to ensure proper interactive component handling
    const client = slack; // Use the global slack client with bot token
    
    try {
      const response = await client.chat.postMessage({
        channel: targetId,
        text: `Task created: ${task.title || 'Untitled Task'}`,
        blocks,
        unfurl_links: false,
        unfurl_media: false
      });
      
      console.log(`Confirmation message sent successfully, timestamp: ${response.ts}`);
      return response.ts;
    } catch (error) {
      console.error(`Error sending Slack task confirmation to ${targetId}:`, error);
      
      // Try with a fallback approach if sending to the user failed
      if (sendAsDM && user?.slackUserId && channelId && channelId !== user.slackUserId) {
        try {
          console.log(`Attempting fallback - sending to original channel: ${channelId}`);
          const fallbackResponse = await client.chat.postMessage({
            channel: channelId,
            text: `Task created: ${task.title || 'Untitled Task'}`,
            blocks,
            unfurl_links: false,
            unfurl_media: false
          });
          
          console.log(`Fallback confirmation sent successfully, timestamp: ${fallbackResponse.ts}`);
          return fallbackResponse.ts;
        } catch (fallbackError) {
          console.error('Fallback confirmation also failed:', fallbackError);
        }
      }
      
      throw error;
    }
  } catch (error) {
    console.error('Error in sendTaskConfirmation:', error);
    // Don't throw here, just return undefined
    return undefined;
  }
}