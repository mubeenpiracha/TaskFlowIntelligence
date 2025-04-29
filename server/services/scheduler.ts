/**
 * Task scheduler service that processes unscheduled tasks
 * and creates calendar events for them
 */
import { storage } from '../storage';
import { createEvent, getCalendarEvents } from './calendarService';
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
  
  // TEMP: Disabled during schema migration
  console.log('[SCHEDULER] Service temporarily disabled during schema migration');
  
  // Uncomment to re-enable scheduler
  // Immediately run once
  // scheduleUnscheduledTasks();
  
  // Then set interval for future runs
  // setInterval(scheduleUnscheduledTasks, SCHEDULE_INTERVAL);
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
    
    // TEMPORARY FIX: Use a single user with ID 1 until we complete schema migration
    // This prevents errors with the new schema fields
    const user = await storage.getUser(1);
    
    if (user) {
      // Process just this user as a compatibility measure
      if (!user.googleRefreshToken) {
        console.log(`[SCHEDULER] User ${user.id} doesn't have Google Calendar connected, skipping`);
      } else {
        // Get tasks that are accepted but not scheduled yet
        const unscheduledTasks = await storage.getTasksByStatus(user.id, 'accepted');
        console.log(`[SCHEDULER] Found ${unscheduledTasks.length} unscheduled tasks for user ${user.id}`);
        
        if (unscheduledTasks.length > 0) {
          await scheduleTasksForUser(user, unscheduledTasks);
        }
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
      
      // User's timezone
      const userTimezone = user.timezone || 'UTC';
      
      // Determine time required for the task
      let taskDurationMs = 3600000; // 1 hour default
      if (task.timeRequired) {
        const [hours, minutes] = task.timeRequired.split(':').map(Number);
        taskDurationMs = (hours * 60 * 60 * 1000) + (minutes * 60 * 1000);
      }
      console.log(`[SCHEDULER] Task ${task.id} requires ${taskDurationMs / 60000} minutes`);
      
      // Determine the deadline (due date/time or a reasonable future date)
      let deadline = new Date();
      if (task.dueDate) {
        if (task.dueTime) {
          deadline = new Date(`${task.dueDate}T${task.dueTime}`);
        } else {
          deadline = new Date(task.dueDate);
          deadline.setHours(23, 59, 59); // End of the day
        }
      } else {
        // No due date, use default based on priority
        const priorityDays = task.priority === 'high' ? 1 : 
                            task.priority === 'medium' ? 3 : 7;
        deadline.setDate(deadline.getDate() + priorityDays);
      }
      
      console.log(`[SCHEDULER] Task ${task.id} deadline: ${deadline.toISOString()}`);
      
      // Get working hours for this user
      let workingHours = await storage.getWorkingHours(user.id);
      
      // Default working hours if none set (9 AM - 5 PM)
      if (!workingHours) {
        console.log(`[SCHEDULER] No working hours found for user ${user.id}, using default 9 AM - 5 PM`);
        workingHours = {
          id: 0,
          userId: user.id,
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true, 
          saturday: false,
          sunday: false,
          startTime: '09:00',
          endTime: '17:00',
          breakStartTime: null,
          breakEndTime: null,
          focusTimeEnabled: false,
          focusTimeDuration: null,
          focusTimePreference: null
        };
      }
      
      // Get the start date for calendar query
      const now = new Date();
      const startDate = new Date(now);
      
      // End date for calendar query is the deadline
      const endDate = new Date(deadline);
      
      console.log(`[SCHEDULER] Fetching calendar events from ${startDate.toISOString()} to ${endDate.toISOString()}`);
      
      // Fetch existing calendar events
      let existingEvents: Array<any> = [];
      try {
        existingEvents = await getCalendarEvents(user, startDate, endDate);
        console.log(`[SCHEDULER] Found ${existingEvents.length} existing events in calendar`);
      } catch (error: any) {
        console.error(`[SCHEDULER] Error fetching calendar events: ${error.message}`);
        existingEvents = [];
      }
      
      // Convert existing events to busy time slots
      const busySlots: Array<{start: Date, end: Date}> = [];
      
      for (const event of existingEvents) {
        const start = event.start?.dateTime ? new Date(event.start.dateTime) : null;
        const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;
        
        if (start && end) {
          busySlots.push({ start, end });
        }
      }
      
      console.log(`[SCHEDULER] Converted ${busySlots.length} events to busy slots`);
      
      // Find available slots
      const availableSlots = findAvailableSlots(
        startDate, 
        endDate, 
        busySlots,
        taskDurationMs, 
        workingHours,
        userTimezone
      );
      
      console.log(`[SCHEDULER] Found ${availableSlots.length} available slots`);
      
      if (availableSlots.length === 0) {
        console.warn(`[SCHEDULER] No available slots found for task ${task.id}, will use fallback scheduling`);
        // Use simple scheduling as fallback
        const { startTime, endTime } = calculateTaskTimeSlot(task);
        
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
        
        console.log(`[SCHEDULER] Creating fallback Google Calendar event for task ${task.id}`);
        scheduleTaskWithEventData(user, task, eventData);
        continue;
      }
      
      // Select the best slot based on task priority and deadline
      const optimalSlot = selectOptimalSlot(
        availableSlots, 
        task.priority || 'medium', 
        deadline,
        now
      );
      
      console.log(`[SCHEDULER] Selected optimal slot: ${optimalSlot.start.toISOString()} - ${optimalSlot.end.toISOString()}`);
      
      // Create event data with the optimal slot
      const eventData = {
        summary: task.title,
        description: task.description || undefined,
        start: {
          dateTime: optimalSlot.start.toISOString().replace('Z', ''),
          timeZone: userTimezone
        },
        end: {
          dateTime: optimalSlot.end.toISOString().replace('Z', ''),
          timeZone: userTimezone
        }
      };
      
      console.log(`[SCHEDULER] Creating Google Calendar event for task ${task.id} with data:`, JSON.stringify(eventData, null, 2));
      
      // Schedule the task with the selected event data
      await scheduleTaskWithEventData(user, task, eventData);
      
    } catch (error: any) {
      console.error(`[SCHEDULER] Error scheduling task ${task.id}:`, error);
    }
  }
}

/**
 * Helper function to schedule a task with given event data
 */
async function scheduleTaskWithEventData(user: User, task: Task, eventData: any) {
  try {
    // Create the calendar event
    const event = await createEvent(user, eventData);
    
    if (event?.id) {
      // Parse dates from the event data
      const startTime = eventData.start.dateTime;
      const endTime = eventData.end.dateTime;
      
      // Update task with Google Calendar event ID and mark as scheduled
      await storage.updateTask(task.id, {
        googleEventId: event.id,
        scheduledStart: startTime,
        scheduledEnd: endTime,
        status: 'scheduled'
      });
      
      console.log(`[SCHEDULER] Successfully scheduled task ${task.id} (Google Calendar event: ${event.id})`);
    } else {
      console.warn(`[SCHEDULER] Event created for task ${task.id} but no ID returned`);
    }
  } catch (error: any) {
    console.error(`[SCHEDULER] Error creating calendar event: ${error}`);
  }
}

/**
 * Find available time slots for scheduling
 * @param startDate - Start of date range to search
 * @param endDate - End of date range to search
 * @param busySlots - Array of busy time slots to avoid
 * @param taskDurationMs - Duration needed for the task in milliseconds
 * @param workingHours - User's working hours configuration
 * @param timezone - User's timezone
 * @returns Array of available time slots
 */
function findAvailableSlots(
  startDate: Date, 
  endDate: Date, 
  busySlots: Array<{start: Date, end: Date}>, 
  taskDurationMs: number,
  workingHours: any,
  timezone: string
): Array<{start: Date, end: Date}> {
  
  const availableSlots: Array<{start: Date, end: Date}> = [];
  const workingDays = [
    workingHours.sunday,
    workingHours.monday,
    workingHours.tuesday, 
    workingHours.wednesday,
    workingHours.thursday,
    workingHours.friday,
    workingHours.saturday
  ];
  
  // Parse working hours
  const [startHour, startMinute] = workingHours.startTime.split(':').map(Number);
  const [endHour, endMinute] = workingHours.endTime.split(':').map(Number);
  
  console.log(`[SCHEDULER] Working hours: ${startHour}:${startMinute} - ${endHour}:${endMinute}`);
  console.log(`[SCHEDULER] Working days: ${workingDays.map((day, index) => day ? index : null).filter(day => day !== null).join(', ')}`);
  
  // Start from the current date, rounded up to the next hour for simplicity
  let currentDate = new Date(startDate);
  currentDate.setMinutes(0, 0, 0);
  currentDate.setHours(currentDate.getHours() + 1);
  
  // Generate potential slots during working hours
  while (currentDate < endDate) {
    const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    // Skip non-working days
    if (!workingDays[dayOfWeek]) {
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(startHour, startMinute, 0, 0);
      continue;
    }
    
    // Set current time to start of working hours if before working hours
    const currentHour = currentDate.getHours();
    const currentMinute = currentDate.getMinutes();
    
    if (currentHour < startHour || (currentHour === startHour && currentMinute < startMinute)) {
      currentDate.setHours(startHour, startMinute, 0, 0);
    }
    
    // Skip if after working hours
    if (currentHour > endHour || (currentHour === endHour && currentMinute >= endMinute)) {
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(startHour, startMinute, 0, 0);
      continue;
    }
    
    // Calculate slot end time
    const slotEnd = new Date(currentDate.getTime() + taskDurationMs);
    
    // Check if slot end is after working hours
    if (slotEnd.getHours() > endHour || 
        (slotEnd.getHours() === endHour && slotEnd.getMinutes() > endMinute)) {
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(startHour, startMinute, 0, 0);
      continue;
    }
    
    // Check if the slot overlaps with any busy slots
    const isOverlapping = busySlots.some(busySlot => {
      return (currentDate < busySlot.end && slotEnd > busySlot.start);
    });
    
    if (!isOverlapping) {
      // This is a valid slot
      availableSlots.push({
        start: new Date(currentDate),
        end: new Date(slotEnd)
      });
    }
    
    // Move to next hour
    currentDate.setHours(currentDate.getHours() + 1);
  }
  
  return availableSlots;
}

/**
 * Select the optimal time slot based on task priority and deadline
 * @param availableSlots - Array of available time slots
 * @param priority - Task priority (high, medium, low)
 * @param deadline - Task deadline
 * @param now - Current time
 * @returns The optimal time slot
 */
function selectOptimalSlot(
  availableSlots: Array<{start: Date, end: Date}>,
  priority: string,
  deadline: Date,
  now: Date
): {start: Date, end: Date} {
  
  if (availableSlots.length === 0) {
    throw new Error('No available slots to select from');
  }
  
  // Sort slots by start time (chronological order)
  const sortedSlots = [...availableSlots].sort((a, b) => a.start.getTime() - b.start.getTime());
  
  // For high priority tasks, pick earliest slot
  if (priority === 'high') {
    console.log('[SCHEDULER] High priority task, selecting earliest available slot');
    return sortedSlots[0];
  }
  
  // For low priority tasks, aim for later slots unless close to deadline
  if (priority === 'low') {
    const daysUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    
    if (daysUntilDeadline > 5) {
      // Plenty of time, schedule closer to deadline
      const middleIndex = Math.floor(sortedSlots.length / 2);
      console.log('[SCHEDULER] Low priority task with time to spare, selecting middle slot');
      return sortedSlots[middleIndex];
    }
  }
  
  // For medium priority or low priority close to deadline, pick a balanced slot
  const timeUntilDeadline = deadline.getTime() - now.getTime();
  
  // Find a slot at approximately 1/3 of the way to the deadline for balanced scheduling
  const targetTime = now.getTime() + (timeUntilDeadline / 3);
  
  // Find the closest slot to the target time
  let closestSlot = sortedSlots[0];
  let closestDistance = Math.abs(sortedSlots[0].start.getTime() - targetTime);
  
  for (let i = 1; i < sortedSlots.length; i++) {
    const distance = Math.abs(sortedSlots[i].start.getTime() - targetTime);
    if (distance < closestDistance) {
      closestSlot = sortedSlots[i];
      closestDistance = distance;
    }
  }
  
  console.log('[SCHEDULER] Selected optimal slot based on priority and deadline');
  return closestSlot;
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