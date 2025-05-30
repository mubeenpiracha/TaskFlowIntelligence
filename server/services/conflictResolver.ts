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
        id: event.id,
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

  // Import Slack web API
  const { WebClient } = await import('@slack/web-api');
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

  const eventList = conflictingEvents
    .map(event => `• ${event.summary} (${formatTimeRange(event.originalStart, event.originalEnd)})`)
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

  // Find next available slots for each conflicting event
  for (const event of conflict.conflictingEvents) {
    const eventDuration = event.originalEnd.getTime() - event.originalStart.getTime();
    const nextSlot = await findNextAvailableSlot(
      user,
      new Date(conflict.requiredStartTime.getTime() + conflict.taskDuration),
      eventDuration
    );

    if (nextSlot) {
      // Update the calendar event
      const startIso = formatDateForGoogleCalendar(nextSlot.start, user.timezone);
      const endIso = formatDateForGoogleCalendar(nextSlot.end, user.timezone);
      
      await updateEvent(user, event.id, {
        start: { dateTime: startIso, timeZone: user.timezone },
        end: { dateTime: endIso, timeZone: user.timezone }
      });

      console.log(`[CONFLICT_RESOLVER] Moved event "${event.summary}" to ${nextSlot.start.toISOString()}`);
    } else {
      console.warn(`[CONFLICT_RESOLVER] Could not find slot for event "${event.summary}"`);
    }
  }

  // Now schedule the original task in the cleared slot
  await scheduleTaskInSlot(user, task, conflict.requiredStartTime, conflict.taskDuration);
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
    conflict.taskDuration
  );

  if (nextSlot) {
    await scheduleTaskInSlot(user, task, nextSlot.start, conflict.taskDuration);
    console.log(`[CONFLICT_RESOLVER] Rescheduled task "${task.title}" to ${nextSlot.start.toISOString()}`);
  } else {
    console.error(`[CONFLICT_RESOLVER] Could not find available slot for task "${task.title}"`);
    // Mark task for manual scheduling
    await storage.updateTask(task.id, { status: 'pending_manual_schedule' });
  }
}

/**
 * Find the next available slot after a given time
 */
async function findNextAvailableSlot(
  user: User,
  searchFrom: Date,
  duration: number
): Promise<{ start: Date; end: Date } | null> {
  const searchEnd = new Date(searchFrom.getTime() + (14 * 24 * 60 * 60 * 1000)); // Search 2 weeks ahead
  
  const events = await getCalendarEvents(user, searchFrom, searchEnd);
  const busySlots = events.flatMap((ev: any) => normalizeEventSlot(ev));

  const workingHours = await storage.getWorkingHours(user.id) ?? defaultWorkingHours(user.id);
  
  return findFirstAvailableSlot(searchFrom, searchEnd, busySlots, duration, workingHours);
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
    description: task.description,
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
  workingHours: any
): { start: Date; end: Date } | null {
  const [startHour, startMin] = workingHours.startTime.split(':').map(Number);
  const [endHour, endMin] = workingHours.endTime.split(':').map(Number);
  
  let current = new Date(searchFrom);
  
  while (current < searchEnd) {
    const dayOfWeek = current.getDay();
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
    
    // Check if within working hours
    const currentHour = current.getHours();
    const currentMin = current.getMinutes();
    
    if (currentHour < startHour || (currentHour === startHour && currentMin < startMin)) {
      current.setHours(startHour, startMin, 0, 0);
      continue;
    }
    
    if (currentHour > endHour || (currentHour === endHour && currentMin >= endMin)) {
      // Move to next day
      current = new Date(current);
      current.setDate(current.getDate() + 1);
      current.setHours(startHour, startMin, 0, 0);
      continue;
    }
    
    const slotEnd = new Date(current.getTime() + duration);
    
    // Check if slot fits within working hours
    const slotEndHour = slotEnd.getHours();
    const slotEndMin = slotEnd.getMinutes();
    
    if (slotEndHour > endHour || (slotEndHour === endHour && slotEndMin > endMin)) {
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

function formatTimeRange(start: Date, end: Date): string {
  return `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}