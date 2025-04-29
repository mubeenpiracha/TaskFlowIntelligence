/**
 * Task scheduler service that processes unscheduled tasks
 * and creates calendar events for them
 */
import { storage } from '../storage';
import { createEvent } from './calendarService';
import { User, Task } from '@shared/schema';
import { addHours, addMinutes, parse, format } from 'date-fns';

// Run interval in milliseconds (check every 30 seconds)
const SCHEDULE_INTERVAL = 30 * 1000;

// Flag to track if scheduler is already running
let isRunning = false;

/**
 * Start the task scheduler service
 */
export function startScheduler() {
  console.log('[SCHEDULER] Starting automatic task scheduler service');
  
  // Immediately run once
  scheduleUnscheduledTasks();
  
  // Then set interval for future runs
  setInterval(scheduleUnscheduledTasks, SCHEDULE_INTERVAL);
}

/**
 * Find and schedule tasks that don't have calendar events yet
 */
async function scheduleUnscheduledTasks() {
  // Prevent concurrent runs
  if (isRunning) {
    console.log('[SCHEDULER] Scheduler already running, skipping this run');
    return;
  }
  
  isRunning = true;
  
  try {
    console.log('[SCHEDULER] Checking for unscheduled tasks...');
    
    // Get all users for processing
    const users = await storage.getAllUsers();
    
    for (const user of users) {
      if (!user.googleRefreshToken) {
        console.log(`[SCHEDULER] User ${user.id} doesn't have Google Calendar connected, skipping`);
        continue;
      }
      
      // Get tasks that are accepted but not scheduled yet
      const unscheduledTasks = await storage.getTasksByStatus(user.id, 'accepted');
      console.log(`[SCHEDULER] Found ${unscheduledTasks.length} unscheduled tasks for user ${user.id}`);
      
      if (unscheduledTasks.length > 0) {
        await scheduleTasksForUser(user, unscheduledTasks);
      }
    }
    
    console.log('[SCHEDULER] Finished checking for unscheduled tasks');
  } catch (error) {
    console.error('[SCHEDULER] Error in scheduler:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Schedule a batch of tasks for a specific user
 * @param user - User to schedule tasks for
 * @param tasks - Array of tasks to schedule
 */
async function scheduleTasksForUser(user: User, tasks: Task[]) {
  console.log(`[SCHEDULER] Processing ${tasks.length} tasks for user ${user.id}`);
  
  for (const task of tasks) {
    try {
      // Skip if already has a Google Event ID
      if (task.googleEventId) {
        console.log(`[SCHEDULER] Task ${task.id} already has a Google Calendar event (${task.googleEventId}), skipping`);
        continue;
      }
      
      console.log(`[SCHEDULER] Scheduling task ${task.id}: ${task.title}`);
      
      // Determine start and end times based on task details
      const { startTime, endTime } = calculateTaskTimeSlot(task);
      
      // User's timezone
      const userTimezone = user.timezone || 'UTC';
      
      console.log(`[SCHEDULER] Calculated time slot for task ${task.id}: ${startTime.toISOString()} - ${endTime.toISOString()} (${userTimezone})`);
      
      // Create event data
      const eventData = {
        summary: task.title,
        description: task.description || undefined,
        start: {
          dateTime: startTime.toISOString().replace('Z', ''),
          timeZone: userTimezone
        },
        end: {
          dateTime: endTime.toISOString().replace('Z', ''),
          timeZone: userTimezone
        }
      };
      
      console.log(`[SCHEDULER] Creating Google Calendar event for task ${task.id} with data:`, JSON.stringify(eventData, null, 2));
      
      // Create the calendar event
      const event = await createEvent(user, eventData);
      
      if (event?.id) {
        // Update task with Google Calendar event ID and mark as scheduled
        await storage.updateTask(task.id, {
          googleEventId: event.id,
          scheduledStart: startTime.toISOString().replace('Z', ''),
          scheduledEnd: endTime.toISOString().replace('Z', ''),
          status: 'scheduled'
        });
        
        console.log(`[SCHEDULER] Successfully scheduled task ${task.id} (Google Calendar event: ${event.id})`);
      } else {
        console.warn(`[SCHEDULER] Event created for task ${task.id} but no ID returned`);
      }
    } catch (error) {
      console.error(`[SCHEDULER] Error scheduling task ${task.id}:`, error);
    }
  }
}

/**
 * Calculate an appropriate time slot for a task
 * @param task - Task to schedule
 * @returns Object with start and end times
 */
function calculateTaskTimeSlot(task: Task): { startTime: Date, endTime: Date } {
  // Start with current time as a base
  const now = new Date();
  let startTime = new Date();
  
  // If task has a due date/time, use that to calculate backward
  if (task.dueDate) {
    if (task.dueTime) {
      // Create date from due date and time
      const dueDateTime = parse(
        `${task.dueDate} ${task.dueTime}`, 
        'yyyy-MM-dd HH:mm', 
        new Date()
      );
      
      // Schedule 1 day before due date for medium priority
      // Adjust based on priority
      if (task.priority === 'high') {
        startTime = new Date(dueDateTime);
        startTime.setHours(startTime.getHours() - 4); // 4 hours before for high priority
      } else if (task.priority === 'medium') {
        startTime = new Date(dueDateTime);
        startTime.setHours(startTime.getHours() - 24); // 1 day before for medium priority
      } else {
        startTime = new Date(dueDateTime);
        startTime.setHours(startTime.getHours() - 48); // 2 days before for low priority
      }
      
      // If the calculated start time is in the past, move it to now + 1 hour
      if (startTime < now) {
        startTime = new Date(now);
        startTime.setHours(now.getHours() + 1);
      }
    } else {
      // Just due date without time, schedule for morning of due date
      startTime = parse(task.dueDate, 'yyyy-MM-dd', new Date());
      startTime.setHours(9, 0, 0, 0); // 9:00 AM
      
      // If the due date is today and it's already past 9 AM, schedule for now + 1 hour
      if (startTime < now) {
        startTime = new Date(now);
        startTime.setHours(now.getHours() + 1);
      }
    }
  } else {
    // No due date, schedule based on priority
    startTime = new Date(now);
    
    if (task.priority === 'high') {
      startTime.setHours(now.getHours() + 1); // Schedule in 1 hour for high priority
    } else if (task.priority === 'medium') {
      startTime.setHours(now.getHours() + 3); // Schedule in 3 hours for medium priority
    } else {
      startTime.setHours(now.getHours() + 24); // Schedule tomorrow for low priority
    }
  }
  
  // Calculate end time based on time required
  let endTime: Date;
  
  if (task.timeRequired) {
    const [hours, minutes] = task.timeRequired.split(':').map(Number);
    endTime = new Date(startTime);
    
    if (!isNaN(hours)) endTime = addHours(endTime, hours);
    if (!isNaN(minutes)) endTime = addMinutes(endTime, minutes);
  } else {
    // Default to 1 hour if no time required specified
    endTime = addHours(startTime, 1);
  }
  
  return { startTime, endTime };
}