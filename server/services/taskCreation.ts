import { storage } from '../storage';
import { sendMessage } from './slack';
import { createCalendarEvent } from './google';
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
  // Remove any user mentions like <@U12345678>
  let cleanText = messageText.replace(/<@[A-Z0-9]+>/g, '').trim();
  
  // If the text is too long, truncate it
  if (cleanText.length > 100) {
    cleanText = cleanText.substring(0, 97) + '...';
  }
  
  return cleanText;
}

/**
 * Attempts to extract due date information from a message
 * Uses simple pattern matching for common date formats
 * @param messageText - The message text to analyze
 * @returns Object with extracted date or null if none found
 */
export function extractDueDate(messageText: string): { dueDate: string, dueTime: string } | null {
  // This is a simplified implementation
  // Look for patterns like "by tomorrow", "due Friday", etc.
  const text = messageText.toLowerCase();
  const today = new Date();
  
  // Default time is end of workday
  const dueTime = '17:00';
  
  // Check for "today"
  if (text.includes('today') || text.includes('by end of day') || text.includes('by eod')) {
    return {
      dueDate: today.toISOString().split('T')[0],
      dueTime
    };
  }
  
  // Check for "tomorrow"
  if (text.includes('tomorrow')) {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return {
      dueDate: tomorrow.toISOString().split('T')[0],
      dueTime
    };
  }
  
  // Check for "next week"
  if (text.includes('next week')) {
    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return {
      dueDate: nextWeek.toISOString().split('T')[0],
      dueTime
    };
  }
  
  // Check for day names (e.g., "by Monday", "due Friday")
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < dayNames.length; i++) {
    if (text.includes(dayNames[i]) || text.includes(dayNames[i].substring(0, 3))) {
      const targetDay = i;
      const currentDay = today.getDay();
      let daysToAdd = targetDay - currentDay;
      
      // If the day has already passed this week, go to next week
      if (daysToAdd <= 0) {
        daysToAdd += 7;
      }
      
      const dueDate = new Date(today);
      dueDate.setDate(dueDate.getDate() + daysToAdd);
      
      return {
        dueDate: dueDate.toISOString().split('T')[0],
        dueTime
      };
    }
  }
  
  // No specific date found, default to tomorrow
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return {
    dueDate: tomorrow.toISOString().split('T')[0],
    dueTime
  };
}

/**
 * Determines a task's priority based on message content
 * @param messageText - The message text to analyze
 * @returns Priority level (high, medium, low)
 */
export function determinePriority(messageText: string): 'high' | 'medium' | 'low' {
  const text = messageText.toLowerCase();
  
  // Check for high priority indicators
  if (
    text.includes('urgent') ||
    text.includes('asap') ||
    text.includes('as soon as possible') ||
    text.includes('important') ||
    text.includes('critical') ||
    text.includes('right away') ||
    text.includes('emergency')
  ) {
    return 'high';
  }
  
  // Check for low priority indicators
  if (
    text.includes('low priority') ||
    text.includes('when you have time') ||
    text.includes('no rush') ||
    text.includes('eventually') ||
    text.includes('non-urgent') ||
    text.includes('not urgent')
  ) {
    return 'low';
  }
  
  // Default to medium priority
  return 'medium';
}

/**
 * Estimates time required for a task based on message content
 * Uses simple heuristics or falls back to a default
 * @param messageText - The message text to analyze
 * @returns Estimated time required in HH:MM format
 */
export function estimateTimeRequired(messageText: string): string {
  const text = messageText.toLowerCase();
  
  // Check for explicit time mentions (e.g., "takes 30 minutes", "2 hours")
  const hourPattern = /(\d+)\s*(hour|hr|hrs|hours)/i;
  const minutePattern = /(\d+)\s*(minute|min|mins|minutes)/i;
  
  const hourMatch = text.match(hourPattern);
  const minuteMatch = text.match(minutePattern);
  
  let hours = 0;
  let minutes = 0;
  
  if (hourMatch) {
    hours = parseInt(hourMatch[1], 10);
  }
  
  if (minuteMatch) {
    minutes = parseInt(minuteMatch[1], 10);
  }
  
  // If we found explicit time mention
  if (hours > 0 || minutes > 0) {
    // Convert to hours:minutes format
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
  
  // Default estimates based on message length and complexity
  if (text.length < 50) {
    return '00:30'; // 30 minutes for short tasks
  } else if (text.length < 200) {
    return '01:00'; // 1 hour for medium tasks
  } else {
    return '02:00'; // 2 hours for longer tasks
  }
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
  }, 
  userId: number
): Promise<Task> {
  try {
    // Check if a task already exists for this message
    const existingTask = await storage.getTasksBySlackMessageId(message.ts);
    if (existingTask) {
      return existingTask;
    }
    
    // Extract information from the message, or use provided custom values
    const title = message.customTitle || extractTaskTitle(message.text);
    const description = message.customDescription || message.text;
    const priority = message.customPriority || determinePriority(message.text);
    const timeRequired = message.customTimeRequired || estimateTimeRequired(message.text);
    
    // Use custom date/time if provided, otherwise extract from message
    let dueDate: string | null = null;
    let dueTime: string | null = null;
    
    if (message.customDueDate) {
      dueDate = message.customDueDate;
      dueTime = message.customDueTime || null;
    } else {
      const extractedDueDate = extractDueDate(message.text);
      if (extractedDueDate) {
        dueDate = extractedDueDate.dueDate;
        dueTime = extractedDueDate.dueTime;
      }
    }
    
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
      googleEventId: null
    };
    
    // Create the task in storage
    const createdTask = await storage.createTask(taskData);
    
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
        
        // Create an event on the user's calendar
        const event = await createCalendarEvent(
          user.googleRefreshToken,
          {
            summary: `Task: ${createdTask.title}`,
            description: createdTask.description || '',
            start: {
              dateTime: startDate.toISOString(),
            },
            end: {
              dateTime: endDate.toISOString(),
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
  sendAsDM: boolean = true,
  userToken?: string
): Promise<string | undefined> {
  try {
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
            text: `*Task*\n${task.title}`
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
    const user = await storage.getUser(task.userId);
    
    // If sendAsDM is true and we have a Slack user ID, send as DM
    const targetId = sendAsDM && user?.slackUserId 
      ? user.slackUserId  // Send to user's DM
      : channelId;        // Send to original channel
    
    // Send the confirmation message
    return await sendMessage(
      targetId,
      `Task created: ${task.title}`,
      blocks,
      userToken
    );
  } catch (error) {
    console.error('Error sending task confirmation to Slack:', error);
    // Don't throw here, just return undefined
    return undefined;
  }
}