/**
 * Conflict resolution service for handling scheduling conflicts
 * When no available slots exist, this service helps resolve conflicts by:
 * 1. Asking users whether to bump existing events or push the current task
 * 2. Moving conflicting events to next available slots
 * 3. Finding alternative scheduling for the current task
 */

import { storage } from "../storage";
import { getCalendarEvents, updateEvent, deleteEvent } from "./calendarService";
import { User, Task } from "@shared/schema";
import { addMinutes } from "date-fns";
import { formatDateForGoogleCalendar } from "../utils/dateUtils";
import { sendMessage } from "./slack";

interface ConflictingEvent {
  id: string;
  summary: string;
  start: { dateTime: string };
  end: { dateTime: string };
  originalStart: Date;
  originalEnd: Date;
}

interface ConflictResolutionRequest {
  taskId: number;
  userId: number;
  conflictingEvents: ConflictingEvent[];
  requiredStartTime: Date;
  taskDeadline: Date;
  taskDuration: number;
}

// Store pending conflict resolutions
const pendingConflicts = new Map<string, ConflictResolutionRequest>();

/**
 * Handle scheduling conflict when no available slots are found
 */
export async function handleSchedulingConflict(
  user: User,
  task: Task,
  requiredStartTime: Date,
  deadline: Date,
  taskDuration: number
): Promise<boolean> {
  console.log(`[CONFLICT_RESOLVER] Handling scheduling conflict for task ${task.id}`);
  
  try {
    // Find conflicting events in the required time window
    const conflictingEvents = await findConflictingEvents(
      user,
      requiredStartTime,
      new Date(requiredStartTime.getTime() + taskDuration),
      deadline
    );

    if (conflictingEvents.length === 0) {
      console.log(`[CONFLICT_RESOLVER] No conflicting events found, task cannot be scheduled`);
      return false;
    }

    console.log(`[CONFLICT_RESOLVER] Found ${conflictingEvents.length} conflicting events`);

    // Create a unique conflict ID
    const conflictId = `conflict_${task.id}_${Date.now()}`;
    
    // Store the conflict resolution request
    pendingConflicts.set(conflictId, {
      taskId: task.id,
      userId: user.id,
      conflictingEvents,
      requiredStartTime,
      taskDeadline: deadline,
      taskDuration
    });

    // Send Slack message asking user for resolution choice
    await sendConflictResolutionMessage(user, task, conflictingEvents, conflictId);
    
    return true; // Conflict resolution initiated
  } catch (error) {
    console.error(`[CONFLICT_RESOLVER] Error handling conflict:`, error);
    return false;
  }
}

/**
 * Find events that conflict with the required scheduling window
 */
async function findConflictingEvents(
  user: User,
  requiredStart: Date,
  requiredEnd: Date,
  searchUntil: Date
): Promise<ConflictingEvent[]> {
  // Get calendar events from required start time to deadline
  const events = await getCalendarEvents(user, requiredStart, searchUntil);
  
  const conflictingEvents: ConflictingEvent[] = [];
  
  for (const event of events) {
    if (!event.start?.dateTime || !event.end?.dateTime) continue;
    
    const eventStart = new Date(event.start.dateTime);
    const eventEnd = new Date(event.end.dateTime);
    
    // Check if event overlaps with required time window
    if (eventStart < requiredEnd && eventEnd > requiredStart) {
      conflictingEvents.push({
        id: event.id || '',
        summary: event.summary || 'Untitled Event',
        start: event.start,
        end: event.end,
        originalStart: eventStart,
        originalEnd: eventEnd
      });
    }
  }
  
  return conflictingEvents.sort((a, b) => a.originalStart.getTime() - b.originalStart.getTime());
}

/**
 * Send Slack message asking user how to resolve the conflict
 */
async function sendConflictResolutionMessage(
  user: User,
  task: Task,
  conflictingEvents: ConflictingEvent[],
  conflictId: string
): Promise<void> {
  if (!user.slackUserId) {
    console.warn(`[CONFLICT_RESOLVER] User ${user.id} has no Slack ID, cannot send conflict message`);
    return;
  }

  console.log(`[CONFLICT_RESOLVER] User timezone: ${user.timezone}, offset: ${user.timezoneOffset}`);

  // Import Slack web API
  const { WebClient } = await import('@slack/web-api');
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

  // Convert event times to user's timezone for display
  const eventList = conflictingEvents
    .map(event => {
      // Use proper timezone formatting with user's timezone
      const startTime = event.originalStart.toLocaleTimeString("en-US", {
        timeZone: user.timezone || "UTC",
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const endTime = event.originalEnd.toLocaleTimeString("en-US", {
        timeZone: user.timezone || "UTC", 
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      
      console.log(`[CONFLICT_RESOLVER] Event ${event.summary}: UTC ${event.originalStart.toISOString()} -> User TZ ${startTime} - ${endTime}`);
      
      return `• ${event.summary} (${startTime} - ${endTime})`;
    })
    .join('\n');

  const message = {
    channel: user.slackUserId,
    text: `⚠️ Scheduling Conflict Detected`,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "⚠️ Scheduling Conflict"
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `I need to schedule "*${task.title}*" but there are conflicting events:\n\n${eventList}\n\nHow would you like me to resolve this?`
        }
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Bump Existing Events"
            },
            style: "primary",
            action_id: "bump_events",
            value: conflictId
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Reschedule This Task"
            },
            action_id: "reschedule_task", 
            value: conflictId
          }
        ]
      }
    ]
  };

  try {
    await slack.chat.postMessage(message);
    console.log(`[CONFLICT_RESOLVER] Sent conflict resolution message for conflict ${conflictId}`);
  } catch (error) {
    console.error(`[CONFLICT_RESOLVER] Failed to send Slack message:`, error);
  }
}

/**
 * Handle user's conflict resolution choice
 */
export async function handleConflictResolution(
  conflictId: string,
  action: 'bump_events' | 'reschedule_task'
): Promise<boolean> {
  const conflict = pendingConflicts.get(conflictId);
  if (!conflict) {
    console.error(`[CONFLICT_RESOLVER] Conflict ${conflictId} not found`);
    return false;
  }

  const user = await storage.getUser(conflict.userId);
  if (!user) {
    console.error(`[CONFLICT_RESOLVER] User ${conflict.userId} not found`);
    return false;
  }

  const task = await storage.getTask(conflict.taskId);
  if (!task) {
    console.error(`[CONFLICT_RESOLVER] Task ${conflict.taskId} not found`);
    return false;
  }

  try {
    if (action === 'bump_events') {
      await bumpConflictingEvents(user, task, conflict);
    } else {
      await rescheduleTask(user, task, conflict);
    }
    
    // Remove from pending conflicts
    pendingConflicts.delete(conflictId);
    return true;
  } catch (error) {
    console.error(`[CONFLICT_RESOLVER] Error resolving conflict:`, error);
    return false;
  }
}

/**
 * Bump conflicting events to next available slots and schedule the task
 */
async function bumpConflictingEvents(
  user: User,
  task: Task,
  conflict: ConflictResolutionRequest
): Promise<void> {
  console.log(`[CONFLICT_RESOLVER] Bumping ${conflict.conflictingEvents.length} conflicting events`);

  const bumpResults: Array<{
    event: ConflictingEvent;
    success: boolean;
    newStartTime?: Date;
    newEndTime?: Date;
    errorMessage?: string;
  }> = [];

  // Find next available slots for each conflicting event
  // Start searching from the earliest reasonable time (beginning of next working period)
  const taskEndTime = new Date(conflict.requiredStartTime.getTime() + conflict.taskDuration);
  
  // Sort events by original start time to maintain chronological order
  const sortedEvents = [...conflict.conflictingEvents].sort((a, b) => 
    a.originalStart.getTime() - b.originalStart.getTime()
  );
  
  // Track all newly scheduled slots to avoid overlaps
  const newlyScheduledSlots: Array<{ start: Date; end: Date }> = [];
  
  for (const event of sortedEvents) {
    const eventDuration = event.originalEnd.getTime() - event.originalStart.getTime();
    
    // Start searching from the task end time but ensure we don't bypass working hours validation
    const earliestSearchTime = new Date(Math.max(taskEndTime.getTime(), Date.now()));
    
    const nextSlot = await findNextAvailableSlot(
      user,
      earliestSearchTime,
      eventDuration,
      newlyScheduledSlots // Pass existing scheduled slots to avoid conflicts
    );

    if (nextSlot) {
      try {
        // Update the calendar event
        const startIso = formatDateForGoogleCalendar(nextSlot.start, user.timezone);
        const endIso = formatDateForGoogleCalendar(nextSlot.end, user.timezone);
        
        await updateEvent(user, event.id, {
          start: { dateTime: startIso, timeZone: user.timezone },
          end: { dateTime: endIso, timeZone: user.timezone }
        });

        console.log(`[CONFLICT_RESOLVER] Moved event "${event.summary}" to ${nextSlot.start.toISOString()}`);
        bumpResults.push({
          event,
          success: true,
          newStartTime: nextSlot.start,
          newEndTime: nextSlot.end
        });
        
        // Add this slot to the list of newly scheduled slots
        newlyScheduledSlots.push({ start: nextSlot.start, end: nextSlot.end });
      } catch (error) {
        console.error(`[CONFLICT_RESOLVER] Failed to move event "${event.summary}":`, error);
        bumpResults.push({
          event,
          success: false,
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    } else {
      console.warn(`[CONFLICT_RESOLVER] Could not find slot for event "${event.summary}"`);
      bumpResults.push({
        event,
        success: false,
        errorMessage: 'No available time slot found'
      });
    }
  }

  // Send detailed feedback to user
  console.log(`[CONFLICT_RESOLVER] Sending detailed bump results message with ${bumpResults.length} results`);
  await sendBumpResultsMessage(user, task, bumpResults);

  // Only schedule the original task if at least some events were successfully moved
  const successfulBumps = bumpResults.filter(result => result.success);
  if (successfulBumps.length > 0) {
    await scheduleTaskInSlot(user, task, conflict.requiredStartTime, conflict.taskDuration);
  } else {
    console.error(`[CONFLICT_RESOLVER] No events could be moved, cannot schedule task ${task.id}`);
    await storage.updateTask(task.id, { status: 'pending_manual_schedule' });
  }
}

/**
 * Find next available slot for the task instead of bumping events
 */
async function rescheduleTask(
  user: User,
  task: Task,
  conflict: ConflictResolutionRequest
): Promise<void> {
  console.log(`[CONFLICT_RESOLVER] Finding next available slot for task ${task.id}`);

  const nextSlot = await findNextAvailableSlot(
    user,
    new Date(conflict.requiredStartTime.getTime() + conflict.taskDuration),
    conflict.taskDuration,
    [] // No additional busy slots for reschedule
  );

  if (nextSlot) {
    await scheduleTaskInSlot(user, task, nextSlot.start, conflict.taskDuration);
    console.log(`[CONFLICT_RESOLVER] Rescheduled task "${task.title}" to ${nextSlot.start.toISOString()}`);
    
    // Send success message to user
    if (user.slackUserId) {
      const startTimeFormatted = nextSlot.start.toLocaleString("en-US", {
        timeZone: user.timezone || "UTC",
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      const endTimeFormatted = nextSlot.end.toLocaleString("en-US", {
        timeZone: user.timezone || "UTC",
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      const successBlocks = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "✅ Task Rescheduled Successfully"
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `I've found a new time slot and scheduled your task successfully!\n\n*"${task.title}"*\n📅 ${startTimeFormatted} - ${endTimeFormatted}`
          }
        }
      ];

      await sendMessage(user.slackUserId, "✅ Task rescheduled successfully", successBlocks);
    }
  } else {
    console.error(`[CONFLICT_RESOLVER] Could not find available slot for task "${task.title}"`);
    // Mark task for manual scheduling
    await storage.updateTask(task.id, { status: 'pending_manual_schedule' });
    
    // Send failure message to user
    if (user.slackUserId) {
      const failureBlocks = [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: "⚠️ Scheduling Challenge"
          }
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `I couldn't find an available time slot to reschedule "*${task.title}*" within the next two weeks.\n\nThe task has been marked for manual scheduling.`
          }
        }
      ];

      await sendMessage(user.slackUserId, "⚠️ Unable to reschedule task", failureBlocks);
    }
  }
}

/**
 * Find the next available slot after a given time
 */
async function findNextAvailableSlot(
  user: User,
  searchFrom: Date,
  duration: number,
  additionalBusySlots: Array<{ start: Date; end: Date }> = []
): Promise<{ start: Date; end: Date } | null> {
  const searchEnd = new Date(searchFrom.getTime() + (14 * 24 * 60 * 60 * 1000)); // Search 2 weeks ahead
  
  const events = await getCalendarEvents(user, searchFrom, searchEnd);
  const existingBusySlots = events.flatMap((ev: any) => normalizeEventSlot(ev));
  
  // Combine existing calendar events with newly scheduled slots to avoid conflicts
  const allBusySlots = [...existingBusySlots, ...additionalBusySlots];

  const workingHours = await storage.getWorkingHours(user.id) ?? defaultWorkingHours(user.id);
  
  return findFirstAvailableSlot(searchFrom, searchEnd, allBusySlots, duration, workingHours, user.timezone || 'UTC');
}

/**
 * Schedule a task in a specific time slot
 */
async function scheduleTaskInSlot(
  user: User,
  task: Task,
  startTime: Date,
  duration: number
): Promise<void> {
  const endTime = new Date(startTime.getTime() + duration);
  
  const startIso = formatDateForGoogleCalendar(startTime, user.timezone);
  const endIso = formatDateForGoogleCalendar(endTime, user.timezone);
  
  const eventData = {
    summary: task.title,
    description: task.description || undefined,
    start: { dateTime: startIso, timeZone: user.timezone },
    end: { dateTime: endIso, timeZone: user.timezone }
  };

  const { createEvent } = await import('./calendarService');
  const event = await createEvent(user, eventData);
  
  if (event?.id) {
    await storage.updateTask(task.id, {
      googleEventId: event.id,
      scheduledStart: startIso,
      scheduledEnd: endIso,
      status: 'scheduled'
    });
    console.log(`[CONFLICT_RESOLVER] Successfully scheduled task ${task.id} as event ${event.id}`);
  }
}

// Helper functions (reusing from newScheduler.ts)
function normalizeEventSlot(ev: any): Array<{ start: Date; end: Date }> {
  if (ev && ev.start && ev.start.date) {
    const dayStart = new Date(ev.start.date);
    return [{ start: dayStart, end: addMinutes(dayStart, 1439) }];
  }
  if (ev && ev.start && ev.start.dateTime && ev.end && ev.end.dateTime) {
    return [
      { start: new Date(ev.start.dateTime), end: new Date(ev.end.dateTime) },
    ];
  }
  return [];
}

function defaultWorkingHours(userId: number) {
  return {
    id: 0,
    userId,
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
    sunday: false,
    startTime: "09:00",
    endTime: "17:00",
    breakStartTime: null,
    breakEndTime: null,
    focusTimeEnabled: false,
    focusTimeDuration: null,
    focusTimePreference: null,
  };
}

function findFirstAvailableSlot(
  searchFrom: Date,
  searchEnd: Date,
  busySlots: Array<{ start: Date; end: Date }>,
  duration: number,
  workingHours: any,
  userTimezone: string = 'UTC'
): { start: Date; end: Date } | null {
  const [startHour, startMin] = workingHours.startTime.split(':').map(Number);
  const [endHour, endMin] = workingHours.endTime.split(':').map(Number);
  
  console.log(`[CONFLICT_RESOLVER] Finding slot with working hours: ${startHour}:${startMin.toString().padStart(2, '0')} - ${endHour}:${endMin.toString().padStart(2, '0')} in timezone ${userTimezone}`);
  
  let current = new Date(searchFrom);
  console.log(`[CONFLICT_RESOLVER] Starting search from: ${current.toISOString()} (${current.toLocaleString()})`);
  
  while (current < searchEnd) {
    // Convert current time to user's timezone for working hours validation
    const userTime = new Date(current.toLocaleString("en-US", { timeZone: userTimezone }));
    const dayOfWeek = userTime.getDay();
    const workingDays = [
      workingHours.sunday,
      workingHours.monday,
      workingHours.tuesday,
      workingHours.wednesday,
      workingHours.thursday,
      workingHours.friday,
      workingHours.saturday
    ];
    
    if (!workingDays[dayOfWeek]) {
      // Skip to next day
      current = new Date(current);
      current.setDate(current.getDate() + 1);
      current.setHours(startHour, startMin, 0, 0);
      continue;
    }
    
    // Check if within working hours (in user's timezone)
    const currentHour = userTime.getHours();
    const currentMin = userTime.getMinutes();
    
    console.log(`[CONFLICT_RESOLVER] Checking slot at ${current.toISOString()}: ${currentHour}:${currentMin.toString().padStart(2, '0')} in ${userTimezone}`);
    
    if (currentHour < startHour || (currentHour === startHour && currentMin < startMin)) {
      console.log(`[CONFLICT_RESOLVER] Before working hours, moving to ${startHour}:${startMin.toString().padStart(2, '0')}`);
      current.setHours(startHour, startMin, 0, 0);
      continue;
    }
    
    if (currentHour > endHour || (currentHour === endHour && currentMin >= endMin)) {
      console.log(`[CONFLICT_RESOLVER] After working hours, moving to next day`);
      // Move to next day
      current = new Date(current);
      current.setDate(current.getDate() + 1);
      current.setHours(startHour, startMin, 0, 0);
      continue;
    }
    
    const slotEnd = new Date(current.getTime() + duration);
    const slotEndUserTime = new Date(slotEnd.toLocaleString("en-US", { timeZone: userTimezone }));
    
    // Check if slot fits within working hours (in user's timezone)
    const slotEndHour = slotEndUserTime.getHours();
    const slotEndMin = slotEndUserTime.getMinutes();
    
    console.log(`[CONFLICT_RESOLVER] Slot would end at ${slotEnd.toISOString()}: ${slotEndHour}:${slotEndMin.toString().padStart(2, '0')} in ${userTimezone}`);
    
    if (slotEndHour > endHour || (slotEndHour === endHour && slotEndMin > endMin)) {
      console.log(`[CONFLICT_RESOLVER] Slot end exceeds working hours, moving to next day`);
      // Move to next day
      current = new Date(current);
      current.setDate(current.getDate() + 1);
      current.setHours(startHour, startMin, 0, 0);
      continue;
    }
    
    // Check for conflicts with busy slots
    const hasConflict = busySlots.some(busy => 
      current < busy.end && slotEnd > busy.start
    );
    
    if (!hasConflict) {
      return { start: new Date(current), end: new Date(slotEnd) };
    }
    
    // Move forward by 15 minutes
    current = addMinutes(current, 15);
  }
  
  return null;
}

/**
 * Send detailed results of the bump operation to the user
 */
async function sendBumpResultsMessage(
  user: User,
  task: Task,
  bumpResults: Array<{
    event: ConflictingEvent;
    success: boolean;
    newStartTime?: Date;
    newEndTime?: Date;
    errorMessage?: string;
  }>
): Promise<void> {
  console.log(`[CONFLICT_RESOLVER] sendBumpResultsMessage called for user ${user.slackUserId} with ${bumpResults.length} results`);
  
  if (!user.slackUserId) {
    console.warn(`[CONFLICT_RESOLVER] No slackUserId found for user ${user.id}`);
    return;
  }

  const { WebClient } = await import('@slack/web-api');
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

  const successfulBumps = bumpResults.filter(result => result.success);
  const failedBumps = bumpResults.filter(result => !result.success);

  let messageText = '';
  let messageBlocks = [];

  if (successfulBumps.length > 0) {
    messageText = `✅ Successfully scheduled "${task.title}"! `;
    
    if (successfulBumps.length === bumpResults.length) {
      messageText += `All ${successfulBumps.length} conflicting events were moved to new times.`;
    } else {
      messageText += `${successfulBumps.length} of ${bumpResults.length} conflicting events were moved.`;
    }

    messageBlocks.push({
      type: "header",
      text: {
        type: "plain_text",
        text: "✅ Task Scheduled Successfully"
      }
    });

    messageBlocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Your task "*${task.title}*" has been scheduled successfully!`
      }
    });

    if (successfulBumps.length > 0) {
      const movedEventsList = successfulBumps.map(result => {
        const newStartTime = result.newStartTime!.toLocaleTimeString("en-US", {
          timeZone: user.timezone || "UTC",
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
        const newEndTime = result.newEndTime!.toLocaleTimeString("en-US", {
          timeZone: user.timezone || "UTC",
          hour: '2-digit', 
          minute: '2-digit',
          hour12: false
        });
        return `• *${result.event.summary}* → ${newStartTime} - ${newEndTime}`;
      }).join('\n');

      messageBlocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Events moved to new times:*\n${movedEventsList}`
        }
      });
    }

    if (failedBumps.length > 0) {
      const failedEventsList = failedBumps.map(result => {
        return `• *${result.event.summary}* - ${result.errorMessage}`;
      }).join('\n');

      messageBlocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*⚠️ Events that couldn't be moved:*\n${failedEventsList}\n\n_These events may be owned by others or have restrictions._`
        }
      });
    }
  } else {
    messageText = `❌ Unable to schedule "${task.title}"`;
    
    messageBlocks.push({
      type: "header",
      text: {
        type: "plain_text",
        text: "❌ Scheduling Failed"
      }
    });

    messageBlocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `I couldn't move any of the conflicting events for "*${task.title}*". The task has been marked for manual scheduling.`
      }
    });

    const failedEventsList = failedBumps.map(result => {
      return `• *${result.event.summary}* - ${result.errorMessage}`;
    }).join('\n');

    messageBlocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Events that couldn't be moved:*\n${failedEventsList}`
      }
    });
  }

  try {
    await slack.chat.postMessage({
      channel: user.slackUserId,
      text: messageText,
      blocks: messageBlocks
    });
    console.log(`[CONFLICT_RESOLVER] Sent bump results message to user ${user.slackUserId}`);
  } catch (error) {
    console.error(`[CONFLICT_RESOLVER] Failed to send bump results message:`, error);
  }
}

/**
 * Convert UTC time to user's timezone
 */
function convertToUserTimezone(utcDate: Date, timezoneOffset: string): Date {
  // The timezone offset format is like "+04:00" for GMT+4
  // We need to ADD the offset to UTC to get local time
  const sign = timezoneOffset.startsWith('-') ? -1 : 1;
  const [hours, minutes] = timezoneOffset.slice(1).split(':').map(Number);
  const offsetMinutes = sign * (hours * 60 + minutes);
  return new Date(utcDate.getTime() + offsetMinutes * 60 * 1000);
}

/**
 * Format time range in user's timezone
 */
function formatTimeRangeInUserTimezone(start: Date, end: Date): string {
  const options: Intl.DateTimeFormatOptions = { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false
  };
  return `${start.toLocaleTimeString([], options)} - ${end.toLocaleTimeString([], options)}`;
}

function formatTimeRange(start: Date, end: Date): string {
  return `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}