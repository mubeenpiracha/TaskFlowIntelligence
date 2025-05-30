/**
 * Task scheduler service that processes unscheduled tasks
 * and creates calendar events for them
 */
import { storage } from "../storage";
import { createEvent, getCalendarEvents } from "./calendarService";
import { User, Task } from "@shared/schema";
import { addMinutes } from "date-fns";
import { handleCalendarTokenExpiration } from "./calendarReconnect";
import {
  formatDateWithOffset,
  convertToUserTimezone,
} from "../utils/offsetUtils";
import { sendMessage, sendInteractiveMessage } from "./slack";

// Run interval in milliseconds (check every 30 seconds)
const SCHEDULE_INTERVAL = 30 * 1000;
// Flag to track if scheduler is already running
let isRunning = false;

/**
 * Start the task scheduler service
 */
export function startScheduler() {
  console.log("[SCHEDULER] Starting automatic task scheduler service");
  scheduleUnscheduledTasks();
  setInterval(scheduleUnscheduledTasks, SCHEDULE_INTERVAL);
}

/**
 * Find and schedule tasks that don't have calendar events yet
 */
async function scheduleUnscheduledTasks() {
  if (isRunning) return;
  isRunning = true;
  try {
    console.log("[SCHEDULER] Checking for unscheduled tasks...");

    // Using a single user with ID 1 for now
    const user = await storage.getUser(1);
    if (!user?.googleRefreshToken) return;

    const tasks = await storage.getTasksByStatus(user.id, "accepted");
    // Filter out tasks that are waiting for conflict resolution to prevent duplicate messages
    const tasksToProcess = tasks.filter(task => task.status !== 'pending_conflict_resolution');
    
    console.log(
      `[SCHEDULER] Found ${tasks.length} unscheduled tasks for user ${user.id}`,
    );
    console.log(
      `[SCHEDULER] Processing ${tasksToProcess.length} tasks (${tasks.length - tasksToProcess.length} waiting for conflict resolution)`,
    );

    if (tasksToProcess.length) {
      try {
        await scheduleTasksForUser(user, tasksToProcess);
      } catch (err: any) {
        if (err.message.includes("No available slots")) {
          console.error("[SCHEDULER] Out of slots:", err.message);
          // TODO: mark for manual scheduling
        } else {
          throw err;
        }
      }
    }
  } catch (error) {
    console.error("[SCHEDULER] Error in scheduler:", error);
  } finally {
    isRunning = false;
  }
}

/**
 * Schedule tasks for a user
 */
async function scheduleTasksForUser(user: User, tasks: Task[]) {
  console.log(
    `[SCHEDULER] Processing ${tasks.length} tasks for user ${user.id}`,
  );

  // Get user's timezone offset for proper date handling (moved outside loop)
  const userOffset = user.timezoneOffset || "+00:00";

  for (const task of tasks) {
    if (task.googleEventId) continue;

    try {
      console.log(
        `[SCHEDULER DEBUG] Processing task ${task.id}: "${task.title}"`,
      );
      console.log(`[SCHEDULER DEBUG] Task timeRequired: ${task.timeRequired}`);
      console.log(`[SCHEDULER DEBUG] Task dueDate: ${task.dueDate}`);
      console.log(`[SCHEDULER DEBUG] Task dueTime: ${task.dueTime}`);
      console.log(`[SCHEDULER DEBUG] Task priority: ${task.priority}`);

      const durationMs = parseDuration(task.timeRequired) ?? 3600000;
      console.log(
        `[SCHEDULER DEBUG] Parsed duration: ${durationMs}ms (${durationMs / 60000} minutes)`,
      );

      const now = new Date();
      console.log(`[SCHEDULER DEBUG] Current time: ${now}`);

      const deadline = computeDeadline(task, now, userOffset);
      console.log(`[SCHEDULER DEBUG] Computed deadline: ${deadline}`);

      // Convert dates to user's timezone for calendar queries
      const userNow = convertToUserTimezone(now, userOffset);
      const userDeadline = convertToUserTimezone(deadline, userOffset);

      // Extend busy query window to catch events that started before now
      const queryStart = new Date(userNow.getTime() - durationMs);
      const queryEnd = userDeadline;

      console.log(
        `[SCHEDULER DEBUG] Query start (now - duration): ${queryStart}`,
      );
      console.log(`[SCHEDULER DEBUG] Query end (deadline): ${queryEnd}`);
      console.log(
        `[SCHEDULER DEBUG] Query range is ${(queryEnd.getTime() - queryStart.getTime()) / (1000 * 60 * 60 * 24)} days`,
      );

      console.log(
        `[SCHEDULER] Fetching events from ${queryStart} to ${queryEnd}`,
      );

      const events = await getCalendarEvents(user, queryStart, queryEnd);
      console.log(events);
      const busySlots = events.flatMap((ev) => parseBusySlots(ev));
      console.log(`[SCHEDULER] ${busySlots.length} busy slots loaded`);

      console.log(`[SCHEDULER DEBUG] Calling findAvailableSlots with:`);
      console.log(`[SCHEDULER DEBUG] - now: ${now}`);
      console.log(`[SCHEDULER DEBUG] - deadline: ${deadline}`);
      console.log(`[SCHEDULER DEBUG] - busySlots count: ${busySlots.length}`);
      console.log(busySlots);
      console.log(`[SCHEDULER DEBUG] - durationMs: ${durationMs}`);
      console.log(`[SCHEDULER DEBUG] - userId: ${user.id}`);

      // Check for priority-based conflicts with existing scheduled tasks
      console.log(`[SCHEDULER] Checking for priority conflicts with existing tasks for task ${task.id} (priority: ${task.priority})`);
      
      // Get all scheduled tasks for this user to check for priority conflicts
      const existingTasks = await storage.getTasksByStatus(user.id, 'scheduled');
      console.log(`[SCHEDULER] Found ${existingTasks.length} existing scheduled tasks to check for conflicts`);
      
      // Check if this high priority task conflicts with any lower priority tasks
      const taskPriority = getPriorityValue(task.priority || 'medium');
      let priorityConflictResolved = false;
      
      for (const existingTask of existingTasks) {
        if (!existingTask.scheduledStart || !existingTask.scheduledEnd) continue;
        
        const existingStart = new Date(existingTask.scheduledStart);
        const existingEnd = new Date(existingTask.scheduledEnd);
        const existingPriority = getPriorityValue(existingTask.priority || 'medium');
        
        // Check for time overlap and priority difference
        const wouldOverlap = (userNow < existingEnd && userDeadline > existingStart);
        const hasHigherPriority = taskPriority > existingPriority;
        
        if (wouldOverlap && hasHigherPriority) {
          console.log(`[SCHEDULER] ⚠️ Priority conflict detected! Task ${task.id} (${task.priority}, priority: ${taskPriority}) conflicts with task ${existingTask.id} (${existingTask.priority}, priority: ${existingPriority})`);
          console.log(`[SCHEDULER] Attempting to bump lower priority task ${existingTask.id} for higher priority task ${task.id}`);
          
          const bumpSuccess = await proposeBumpLowerPriorityTask(user, existingTask, task, userOffset);
          if (bumpSuccess) {
            console.log(`[SCHEDULER] ✅ Successfully bumped task ${existingTask.id}, task ${task.id} has been scheduled`);
            priorityConflictResolved = true;
            return; // Task has been scheduled, move to next
          }
        }
      }
      
      if (priorityConflictResolved) {
        return; // Task was handled through priority bumping
      }

      const available = await findAvailableSlots(
        now,
        deadline,
        busySlots,
        durationMs,
        user.id,
        userOffset,
      );
      console.log(`[SCHEDULER] Found ${available.length} available slots`);
      console.log(available);

      if (available.length === 0) {
        console.log(
          `[SCHEDULER DEBUG] No available slots found! Checking date range...`,
        );
        console.log(`[SCHEDULER DEBUG] Time range: ${now} to ${deadline}`);
        console.log(
          `[SCHEDULER DEBUG] Range duration: ${(deadline.getTime() - now.getTime()) / (1000 * 60 * 60)} hours`,
        );
        if (deadline <= now) {
          console.log(
            `[SCHEDULER DEBUG] ⚠️ PROBLEM: Deadline is in the past or equal to now!`,
          );
        }
      }

      if (!available.length) {
        console.log(`[SCHEDULER] No available slots found, initiating conflict resolution for task ${task.id}`);
        const resolved = await handleSchedulingConflicts(user, task, userNow, userDeadline, busySlots, durationMs, userOffset);
        if (!resolved) {
          throw new Error(`No available slots for task ${task.id} after conflict resolution`);
        }
        continue; // Skip to next task since this one was handled by conflict resolution
      }
      const slot = selectOptimalSlot(
        available,
        task.priority ?? "medium",
        userDeadline,
        userNow,
      );
      console.log(`[SCHEDULER] Chosen slot: ${slot.start} - ${slot.end}`);

      // Use the much simpler offset-based formatting instead of complex IANA timezone handling
      const startIso = formatDateWithOffset(slot.start, userOffset);
      const endIso = formatDateWithOffset(slot.end, userOffset);
      const eventData = {
        summary: task.title,
        description: task.description,
        start: { dateTime: startIso },
        end: { dateTime: endIso },
      };

      await scheduleTaskWithEventData(user, task, eventData);
    } catch (error: any) {
      console.error(
        `[SCHEDULER] Error scheduling task ${task.id}:`,
        error.message,
      );
      if (
        error.name === "TokenExpiredError" ||
        /token.*(expired|revoked)/i.test(error.message)
      ) {
        await handleCalendarTokenExpiration(user.id, {
          id: task.id,
          title: task.title,
        });
      }
    }
  }
}

/**
 * Parse "HH:MM" into milliseconds
 */
function parseDuration(str?: string): number | null {
  if (!str) return null;
  const [h, m] = str.split(":").map((n) => parseInt(n, 10));
  if (isNaN(h) || isNaN(m)) return null;
  return h * 3600000 + m * 60000;
}

/**
 * Compute a deadline Date based on task fields and priority
 */
function computeDeadline(task: Task, now: Date, userOffset?: string): Date {
  console.log(`[DEADLINE DEBUG] Computing deadline for task ${task.id}`);
  console.log(`[DEADLINE DEBUG] Current time: ${now}`);
  console.log(`[DEADLINE DEBUG] Task dueDate: ${task.dueDate}`);
  console.log(`[DEADLINE DEBUG] Task dueTime: ${task.dueTime}`);
  console.log(`[DEADLINE DEBUG] Task priority: ${task.priority}`);

  const dl = new Date(now);
  const addDays =
    task.priority === "high" ? 1 : task.priority === "medium" ? 3 : 7;
  dl.setDate(dl.getDate() + addDays);
  console.log(
    `[DEADLINE DEBUG] Default deadline (now + ${addDays} days): ${dl}`,
  );

  if (task.dueDate) {
    console.log(`[DEADLINE DEBUG] Task has dueDate: ${task.dueDate}`);

    // Slack sends dates without timezone info, so we need to apply user's offset
    let dateTimeString = task.dueDate;
    if (task.dueTime) {
      console.log(`[DEADLINE DEBUG] Task has dueTime: ${task.dueTime}`);
      dateTimeString += `T${task.dueTime}:00`;
    } else {
      dateTimeString += `T17:00:00`; // Default 5pm
    }

    // Apply user's timezone offset to the Slack input
    if (userOffset) {
      dateTimeString += userOffset;
      console.log(
        `[DEADLINE DEBUG] Applied user offset ${userOffset}: ${dateTimeString}`,
      );
    }

    const d = new Date(dateTimeString);
    console.log(`[DEADLINE DEBUG] Final deadline with offset: ${d}`);
    return d;
  }
  console.log(`[DEADLINE DEBUG] Returning priority-based deadline: ${dl}`);
  return dl;
}

export function parseBusySlots(ev: any): Array<{ start: Date; end: Date; eventId?: string; title?: string }> {
  // prefer the dateTime field if present, else date
  const startStr = ev.start?.dateTime ?? ev.start?.date;
  const endStr = ev.end?.dateTime ?? ev.end?.date;
  if (!startStr || !endStr) return [];

  return [
    {
      start: new Date(startStr),
      end: new Date(endStr),
      eventId: ev.id, // Store Google Calendar event ID for proper conflict resolution
      title: ev.summary || ev.title || 'Untitled Event', // Include event title for conflict summaries
    },
  ];
}
/**
 * Convert calendar event into busy slot(s)
 */

/**
 * Find free slots between now and end, avoiding busy slots and respecting working hours
 */
export async function findAvailableSlots(
  now: Date,
  end: Date,
  busy: Array<{ start: Date; end: Date }>,
  dur: number,
  userId: number,
  offset: string = "+00:00",
): Promise<Array<{ start: Date; end: Date }>> {
  const wk = (await storage.getWorkingHours(userId)) ?? defaultHours(userId);
  const days = [
    wk.sunday,
    wk.monday,
    wk.tuesday,
    wk.wednesday,
    wk.thursday,
    wk.friday,
    wk.saturday,
  ];
  const sign = offset.startsWith("-") ? +1 : -1;
  const [h, m] = offset.slice(1).split(":").map(Number);
  const hourAdjustment = sign * h;
  const minuteAdjustment = sign * m;

  const [sh, sm] = [
    Number(wk.startTime.split(":")[0]) + hourAdjustment,
    Number(wk.startTime.split(":")[1]) + minuteAdjustment,
  ];
  const [eh, em] = [
    Number(wk.endTime.split(":")[0]) + hourAdjustment,
    Number(wk.endTime.split(":")[1]) + minuteAdjustment,
  ];
  const bufferMs = 5 * 60 * 1000;

  const slots: Array<{ start: Date; end: Date }> = [];
  let cur = new Date(now);
  const roundedMin = Math.ceil(cur.getMinutes() / 15) * 15;
  cur.setMinutes(roundedMin, 0, 0);

  while (cur < end) {
    const dow = cur.getDay();
    if (!days[dow]) {
      cur = nextDay(cur, sh, sm);
      continue;
    }
    const ch = cur.getHours(),
      cm = cur.getMinutes();
    if (ch < sh || (ch === sh && cm < sm)) {
      cur = addMinutes(cur, 15);
      continue;
    }
    if (ch > eh || (ch === eh && cm >= em)) {
      cur = nextDay(cur, sh, sm);
      continue;
    }
    const slotEnd = addMinutes(cur, dur / 60000);
    if (
      slotEnd.getHours() > eh ||
      (slotEnd.getHours() === eh && slotEnd.getMinutes() > em)
    ) {
      cur = nextDay(cur, sh, sm);
      continue;
    }
    if (wk.breakStartTime && wk.breakEndTime) {
      const [bsH, bsM] = wk.breakStartTime.split(":").map(Number);
      const [beH, beM] = wk.breakEndTime.split(":").map(Number);
      const bs = setTime(cur, bsH, bsM);
      const be = setTime(cur, beH, beM);
      if (cur < be && slotEnd > bs) {
        cur = addMinutes(cur, 15);
        continue;
      }
    }
    const startMs = cur.getTime(),
      endMs = slotEnd.getTime();
    // Check for any overlap with busy slots (no buffer for exact blocking)
    const conflict = busy.some((b) => {
      const busyStart = b.start.getTime();
      const busyEnd = b.end.getTime();

      // True overlap detection: any overlap at all means conflict
      const hasOverlap = startMs < busyEnd && endMs > busyStart;

      if (hasOverlap) {
        console.log(
          `[SCHEDULER DEBUG] Conflict detected: proposed ${new Date(startMs).toISOString()} - ${new Date(endMs).toISOString()} overlaps with busy ${b.start.toISOString()} - ${b.end.toISOString()}`,
        );
      }

      return hasOverlap;
    });
    if (!conflict) slots.push({ start: new Date(cur), end: new Date(slotEnd) });
    cur = addMinutes(cur, 15);
  }
  return slots;
}

function nextDay(date: Date, h: number, m: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  d.setHours(h, m, 0, 0);
  return d;
}

function setTime(date: Date, h: number, m: number): Date {
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}

function defaultHours(userId: number) {
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

function selectOptimalSlot(
  slots: Array<{ start: Date; end: Date }>,
  priority: string,
  deadline: Date,
  now: Date,
): { start: Date; end: Date } {
  if (!slots.length) throw new Error("No available slots to select from");
  slots.sort((a, b) => a.start.getTime() - b.start.getTime());
  if (priority === "high") return slots[0];
  if (priority === "low") {
    const daysLeft = (deadline.getTime() - now.getTime()) / (24 * 3600 * 1000);
    if (daysLeft > 5) return slots[Math.floor(slots.length * 0.7)];
  }
  const target = now.getTime() + (deadline.getTime() - now.getTime()) / 3;
  let best = slots[0],
    dist = Math.abs(best.start.getTime() - target);
  for (const s of slots) {
    const d = Math.abs(s.start.getTime() - target);
    if (d < dist) {
      best = s;
      dist = d;
    }
  }
  return best;
}

function toDateWithOffset(date: Date, offset: string): Date {
  // 1️⃣ parse the offset string into a signed minute count
  const sign = offset[0] === "-" ? -1 : 1;
  const [hStr, mStr] = offset.slice(1).split(":");
  const offsetMinutes = sign * (Number(hStr) * 60 + Number(mStr));

  // 2️⃣ shift the timestamp by offsetMinutes
  const shiftedTs = date.getTime() + offsetMinutes * 60_000;

  // 3️⃣ return a Date for that new timestamp
  return new Date(shiftedTs);
}

async function scheduleTaskWithEventData(user: User, task: Task, data: any) {
  const ev = await createEvent(user, data);
  if (!ev?.id) throw new Error("Failed to create calendar event");
  await storage.updateTask(task.id, {
    googleEventId: ev.id,
    scheduledStart: data.start.dateTime,
    scheduledEnd: data.end.dateTime,
    status: "scheduled",
  });
  console.log(`[SCHEDULER] Task ${task.id} scheduled as event ${ev.id}`);
}

/**
 * Simplified conflict resolution system
 */
async function handleSchedulingConflicts(
  user: User, 
  incomingTask: Task, 
  now: Date, 
  deadline: Date, 
  busySlots: Array<{ start: Date; end: Date; eventId?: string; title?: string }>, 
  durationMs: number,
  userOffset: string
): Promise<boolean | 'handled'> {
  console.log(`[CONFLICT_RESOLUTION] Starting simplified conflict resolution for task ${incomingTask.id}`);
  
  // Get all scheduled internal tasks that might conflict
  const allScheduledTasks = await storage.getTasksByStatus(user.id, 'scheduled');
  const conflictingTasks: Task[] = [];
  
  // Check each scheduled task for time overlap
  for (const scheduledTask of allScheduledTasks) {
    if (!scheduledTask.scheduledStart || !scheduledTask.scheduledEnd) continue;
    
    const taskStart = new Date(scheduledTask.scheduledStart);
    const taskEnd = new Date(scheduledTask.scheduledEnd);
    
    // Check if this would overlap with the desired scheduling window
    const wouldOverlap = (now < taskEnd && deadline > taskStart);
    
    if (wouldOverlap) {
      conflictingTasks.push(scheduledTask);
    }
  }
  
  console.log(`[CONFLICT_RESOLUTION] Found ${conflictingTasks.length} conflicting internal tasks`);
  
  // If there are conflicting internal tasks, ask user what to do
  if (conflictingTasks.length > 0) {
    console.log(`[CONFLICT_RESOLUTION] Asking user about conflicting tasks:`, conflictingTasks.map(t => t.title));
    await askUserAboutConflictingTasks(user, incomingTask, conflictingTasks, userOffset);
    return 'handled'; // User will decide via Slack interaction
  }
  
  // No internal task conflicts - proceed with normal scheduling
  console.log(`[CONFLICT_RESOLUTION] No internal task conflicts found, proceeding with normal scheduling`);
  return true;
}

/**
 * Convert priority string to numeric value for comparison
 */
function getPriorityValue(priority: string): number {
  switch (priority.toLowerCase()) {
    case "high": return 3;
    case "medium": return 2;
    case "low": return 1;
    default: return 2;
  }
}

/**
 * Partition busy slots into system tasks (have taskId) vs external events
 */
async function partitionBusySlots(busySlots: Array<{ start: Date; end: Date; eventId?: string; title?: string }>, user: User) {
  const systemTasks: Task[] = [];
  const externalEvents: Array<{ start: Date; end: Date; title?: string; eventId?: string }> = [];
  
  // Get all scheduled tasks for the user to match against Google event IDs
  const allTasks = await storage.getTasksByUser(user.id);
  const tasksByEventId = new Map<string, Task>();
  
  allTasks.forEach(task => {
    if (task.googleEventId) {
      tasksByEventId.set(task.googleEventId, task);
    }
  });
  
  // Partition based on whether we have a matching task with this event ID
  for (const slot of busySlots) {
    if (slot.eventId && tasksByEventId.has(slot.eventId)) {
      systemTasks.push(tasksByEventId.get(slot.eventId)!);
    } else {
      externalEvents.push({
        start: slot.start,
        end: slot.end,
        title: slot.title || 'Untitled Event',
        eventId: slot.eventId
      });
    }
  }
  
  return { systemTasks, externalEvents };
}



/**
 * Ask user about conflicting internal tasks with simplified approach
 */
async function askUserAboutConflictingTasks(
  user: User,
  incomingTask: Task,
  conflictingTasks: Task[],
  userOffset: string
): Promise<void> {
  console.log(`[CONFLICT_RESOLUTION] Asking user about ${conflictingTasks.length} conflicting tasks`);
  
  if (!user.slackUserId) {
    console.log(`[CONFLICT_RESOLUTION] No Slack user ID found for user ${user.id}`);
    return;
  }

  // Build conflict summary
  const conflictList = conflictingTasks.map(task => {
    const deadlineStr = task.dueDate ? formatDateWithOffset(new Date(task.dueDate), userOffset) : 'No deadline';
    return `• **${task.title}** (${task.priority} priority) - Deadline: ${deadlineStr}`;
  }).join('\n');

  // Update incoming task status to prevent duplicate processing
  await storage.updateTaskStatus(incomingTask.id, "pending_conflict_resolution");

  // Send simplified conflict resolution message
  await sendInteractiveMessage(user.slackUserId, {
    text: `📅 Scheduling Conflict with Your Tasks`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `📅 **Scheduling Conflict**\n\nYour new task **"${incomingTask.title}"** conflicts with these existing tasks:\n\n${conflictList}\n\nWhat would you like to do?`
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Bump Existing Tasks' },
            style: 'primary',
            action_id: 'bump_existing_tasks',
            value: JSON.stringify({
              taskId: incomingTask.id,
              action: 'bump_existing_tasks',
              conflictingTaskIds: conflictingTasks.map(t => t.id)
            })
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Schedule This Later' },
            action_id: 'schedule_later',
            value: JSON.stringify({
              taskId: incomingTask.id,
              action: 'schedule_later'
            })
          }
        ]
      }
    ]
  });

  console.log(`[CONFLICT_RESOLUTION] Sent simplified conflict resolution message for task ${incomingTask.id}`);
}

/**
 * Propose bumping a lower priority task via Slack
 */
async function proposeBumpLowerPriorityTask(
  user: User, 
  existingTask: Task, 
  incomingTask: Task,
  userOffset: string
): Promise<boolean> {
  console.log(`[CONFLICT_RESOLUTION] Proposing to bump lower priority task ${existingTask.id} for incoming task ${incomingTask.id}`);
  
  // Check if existing task has lower priority
  const existingPriority = getPriorityValue(existingTask.priority || 'medium');
  const incomingPriority = getPriorityValue(incomingTask.priority || 'medium');
  
  if (existingPriority >= incomingPriority) {
    console.log(`[CONFLICT_RESOLUTION] Existing task priority (${existingPriority}) not lower than incoming (${incomingPriority})`);
    return false;
  }
  
  try {
    console.log(`[CONFLICT_RESOLUTION] ✅ Bumping lower priority task ${existingTask.id} (priority: ${existingPriority}) for higher priority task ${incomingTask.id} (priority: ${incomingPriority})`);
    
    // Find new slot for the bumped task
    const bumpedDuration = parseDuration(existingTask.timeRequired) ?? 3600000;
    const bumpedDeadline = computeDeadline(existingTask, new Date(), userOffset);
    const newSlot = await findNextAvailableSlot(bumpedDuration, { start: new Date(), end: bumpedDeadline }, user, userOffset);
    
    if (newSlot) {
      console.log(`[CONFLICT_RESOLUTION] Found new slot for bumped task: ${newSlot.start} - ${newSlot.end}`);
      
      // Store the original slot that will be freed
      const freedSlot = {
        start: new Date(existingTask.scheduledStart!),
        end: new Date(existingTask.scheduledEnd!)
      };
      console.log(`[CONFLICT_RESOLUTION] Original slot to be freed: ${freedSlot.start} - ${freedSlot.end}`);
      
      // 1. Reschedule the bumped task to new slot
      await rescheduleTask(existingTask.id, newSlot, userOffset);
      console.log(`[CONFLICT_RESOLUTION] ✅ Bumped task ${existingTask.id} moved to new slot`);
      
      // 2. Schedule incoming task in the freed slot
      await scheduleTaskInSlot(user, incomingTask, freedSlot, userOffset);
      console.log(`[CONFLICT_RESOLUTION] ✅ Incoming task ${incomingTask.id} scheduled in freed slot`);
      
      // 3. Send Slack notification about the bumping
      if (user.slackUserId) {
        try {
          const bumpedTime = formatDateWithOffset(newSlot.start, userOffset);
          const originalTime = formatDateWithOffset(freedSlot.start, userOffset);
          const message = `📅 Task Scheduling Update:\n\n` +
            `• **"${existingTask.title}"** (${existingTask.priority} priority) has been moved from ${originalTime} to ${bumpedTime}\n` +
            `• **"${incomingTask.title}"** (${incomingTask.priority} priority) has been scheduled at ${originalTime}\n\n` +
            `This change was made automatically because the new task has higher priority.`;
          
          await sendMessage(user.slackUserId, message);
          console.log(`[CONFLICT_RESOLUTION] ✅ Sent task bump notification to user ${user.slackUserId}`);
        } catch (error) {
          console.error(`[CONFLICT_RESOLUTION] Failed to send bump notification:`, error);
        }
      }
      
      console.log(`[CONFLICT_RESOLUTION] Successfully bumped task ${existingTask.id} and scheduled incoming task ${incomingTask.id}`);
      return true;
    }
  } catch (error) {
    console.error(`[CONFLICT_RESOLUTION] Error bumping task:`, error);
  }
  
  return false;
}

/**
 * Attempt to reschedule a higher priority task if there's slack time
 */
async function attemptRescheduleHigherPriorityTask(
  user: User,
  existingTask: Task,
  now: Date,
  userOffset: string
): Promise<boolean> {
  console.log(`[CONFLICT_RESOLUTION] Attempting to reschedule higher priority task ${existingTask.id}`);
  
  try {
    const taskDeadline = computeDeadline(existingTask, now, userOffset);
    const taskDuration = parseDuration(existingTask.timeRequired) ?? 3600000;
    
    // Check if there's slack time before the deadline
    const timeUntilDeadline = taskDeadline.getTime() - now.getTime();
    if (timeUntilDeadline > taskDuration * 2) { // At least 2x the task duration as slack
      
      const newSlot = await findNextAvailableSlot(taskDuration, { start: now, end: taskDeadline }, user, userOffset);
      if (newSlot) {
        await rescheduleTask(existingTask.id, newSlot, userOffset);
        console.log(`[CONFLICT_RESOLUTION] Successfully rescheduled higher priority task ${existingTask.id}`);
        return true;
      }
    }
  } catch (error) {
    console.error(`[CONFLICT_RESOLUTION] Error rescheduling task:`, error);
  }
  
  return false;
}

/**
 * Offer overlap scheduling for external events via Slack
 */
async function offerOverlapScheduling(
  user: User,
  incomingTask: Task,
  externalEvents: Array<{ start: Date; end: Date; title?: string }>
) {
  console.log(`[CONFLICT_RESOLUTION] Offering overlap scheduling for task ${incomingTask.id} with ${externalEvents.length} external events`);
  
  // Log user's complete Slack connection status for debugging
  console.log(`[CONFLICT_RESOLUTION] User ${user.id} Slack status:`);
  console.log(`  - slackUserId: ${user.slackUserId || 'NOT SET'}`);
  console.log(`  - slackWorkspace: ${user.slackWorkspace || 'NOT SET'}`);
  console.log(`  - slackAccessToken: ${user.slackAccessToken ? 'SET' : 'NOT SET'}`);
  console.log(`  - workspaceId: ${user.workspaceId || 'NOT SET'}`);
  
  if (!user.slackUserId) {
    console.log(`[CONFLICT_RESOLUTION] ❌ No Slack user ID found for user ${user.id}, cannot send interactive message`);
    console.log(`[CONFLICT_RESOLUTION] User needs to connect their Slack account first`);
    
    // Fallback: Try to send a simple text message instead
    try {
      const { sendSlackMessage } = await import('./slack');
      await sendSlackMessage(user.id, `⚠️ Scheduling conflict detected for task "${incomingTask.title}" with ${externalEvents.length} calendar events. Please check your calendar.`);
      console.log(`[CONFLICT_RESOLUTION] Sent fallback text message instead`);
    } catch (error) {
      console.error(`[CONFLICT_RESOLUTION] Failed to send fallback message:`, error);
    }
    return;
  }
  
  console.log(`[CONFLICT_RESOLUTION] Attempting to send interactive message to Slack user: ${user.slackUserId}`);
  console.log(`[CONFLICT_RESOLUTION] Conflict details - Task: "${incomingTask.title}", Events: ${externalEvents.length}`);

  // First, update task status to prevent sending duplicate messages
  await storage.updateTaskStatus(incomingTask.id, "pending_conflict_resolution");
  console.log(`[CONFLICT_RESOLUTION] Updated task ${incomingTask.id} status to pending_conflict_resolution`);

  try {
    // Import slack service for interactive messaging
    const { sendInteractiveMessage } = await import('./slack');
    
    // Create conflict summary for external events
    const eventSummary = externalEvents.map(event => 
      `• ${event.title || 'Untitled Event'} (${event.start.toLocaleTimeString()} - ${event.end.toLocaleTimeString()})`
    ).join('\n');
    
    // Send interactive Slack message with conflict options
    await sendInteractiveMessage(user.slackUserId, {
      text: `⚠️ Scheduling Conflict with External Events`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Task "${incomingTask.title}" conflicts with existing calendar events:*\n\n${eventSummary}\n\nHow would you like to handle this conflict?`
          }
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Schedule Anyway' },
              style: 'primary',
              action_id: 'schedule_anyway',
              value: JSON.stringify({
                taskId: incomingTask.id,
                action: 'force_schedule'
              })
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Find Alternative Time' },
              action_id: 'find_alternative',
              value: JSON.stringify({
                taskId: incomingTask.id,
                action: 'find_alternative'
              })
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Skip for Now' },
              style: 'danger',
              action_id: 'skip_task',
              value: JSON.stringify({
                taskId: incomingTask.id,
                action: 'skip'
              })
            }
          ]
        }
      ]
    });
    
    console.log(`[CONFLICT_RESOLUTION] Sent external event conflict options to user for task ${incomingTask.id}`);
    
  } catch (error) {
    console.error(`[CONFLICT_RESOLUTION] Failed to send external event conflict message:`, error);
    
    // Fallback: Send a simple text message about the conflict 
    console.log(`[CONFLICT_RESOLUTION] Interactive message failed, trying simple message instead`);
    try {
      const { sendSlackMessage } = await import('./slack');
      const eventSummary = externalEvents.map(event => 
        `• ${event.title || 'Untitled Event'} (${event.start.toLocaleTimeString()} - ${event.end.toLocaleTimeString()})`
      ).join('\n');
      
      await sendSlackMessage(user.id, `⚠️ **Scheduling Conflict Detected**\n\nTask "${incomingTask.title}" conflicts with:\n${eventSummary}\n\nPlease check your calendar and reschedule manually if needed.`);
      console.log(`[CONFLICT_RESOLUTION] Sent simple conflict notification instead of interactive message`);
    } catch (fallbackError) {
      console.error(`[CONFLICT_RESOLUTION] Fallback message also failed:`, fallbackError);
      // Log conflict summary for manual review
      console.log(`[CONFLICT_RESOLUTION] External event conflicts for task ${incomingTask.id}:`);
      externalEvents.forEach(event => {
        console.log(`External event: ${event.start.toISOString()} - ${event.end.toISOString()}`);
      });
    }
  }
}

/**
 * Send conflict summary when no resolution is possible
 */
async function sendConflictSummary(
  user: User,
  incomingTask: Task,
  conflictingEvents: Array<any>
) {
  console.log(`[CONFLICT_RESOLUTION] Sending conflict summary for task ${incomingTask.id}`);
  
  const eventList = conflictingEvents.map(event => 
    `${event.title || 'Unnamed event'}: ${event.start?.toISOString() || event.scheduledStart} - ${event.end?.toISOString() || event.scheduledEnd}`
  ).join('\n');
  
  const summary = `Can't schedule Task "${incomingTask.title}" by deadline due to conflicts with:\n${eventList}`;
  console.log(`[CONFLICT_RESOLUTION] ${summary}`);
  
  // TODO: Implement Slack notification
}

/**
 * Reschedule a task to a new time slot
 */
async function rescheduleTask(taskId: number, newSlot: { start: Date; end: Date }, userOffset: string): Promise<void> {
  console.log(`[CONFLICT_RESOLUTION] Rescheduling task ${taskId} to ${newSlot.start} - ${newSlot.end}`);
  
  // Update task in database
  const startIso = formatDateWithOffset(newSlot.start, userOffset);
  const endIso = formatDateWithOffset(newSlot.end, userOffset);
  
  await storage.updateTask(taskId, {
    scheduledStart: startIso,
    scheduledEnd: endIso
  });
  
  // TODO: Update Google Calendar event if it exists
  console.log(`[CONFLICT_RESOLUTION] Task ${taskId} rescheduled successfully`);
}

/**
 * Schedule a task in a specific time slot
 */
export async function scheduleTaskInSlot(
  user: User,
  task: Task,
  slot: { start: Date; end: Date },
  userOffset: string
): Promise<void> {
  console.log(`[CONFLICT_RESOLUTION] Scheduling task ${task.id} in slot ${slot.start} - ${slot.end}`);
  
  const startIso = formatDateWithOffset(slot.start, userOffset);
  const endIso = formatDateWithOffset(slot.end, userOffset);
  
  const eventData = {
    summary: task.title,
    description: task.description,
    start: { dateTime: startIso },
    end: { dateTime: endIso },
  };
  
  await scheduleTaskWithEventData(user, task, eventData);
}

/**
 * Find next available slot - simplified version for conflict resolution
 */
async function findNextAvailableSlot(
  duration: number,
  window: { start: Date; end: Date },
  user: User,
  userOffset: string
): Promise<{ start: Date; end: Date } | null> {
  try {
    // Get fresh busy slots
    const events = await getCalendarEvents(user, window.start, window.end);
    const busySlots = events.flatMap((ev) => parseBusySlots(ev));
    
    // Find available slots
    const available = await findAvailableSlots(
      window.start,
      window.end,
      busySlots,
      duration,
      user.id,
      userOffset
    );
    
    return available.length > 0 ? available[0] : null;
  } catch (error) {
    console.error(`[CONFLICT_RESOLUTION] Error finding available slot:`, error);
    return null;
  }
}
