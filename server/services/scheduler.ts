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

      // Check for conflicts with existing scheduled tasks using simplified approach
      console.log(`[SCHEDULER] Checking for conflicts with existing scheduled tasks for task ${task.id}`);
      
      // Get all scheduled tasks for this user
      const existingTasks = await storage.getTasksByStatus(user.id, 'scheduled');
      console.log(`[SCHEDULER] Found ${existingTasks.length} existing scheduled tasks to check for conflicts`);
      
      const conflictingTasks: Task[] = [];
      
      // Check each scheduled task for time overlap with the desired scheduling window
      for (const existingTask of existingTasks) {
        if (!existingTask.scheduledStart || !existingTask.scheduledEnd) continue;
        
        const existingStart = new Date(existingTask.scheduledStart);
        const existingEnd = new Date(existingTask.scheduledEnd);
        
        // Check if this would overlap with the desired scheduling window
        const wouldOverlap = (userNow < existingEnd && userDeadline > existingStart);
        
        if (wouldOverlap) {
          conflictingTasks.push(existingTask);
          console.log(`[SCHEDULER] ⚠️ Conflict detected with task ${existingTask.id} "${existingTask.title}" (${existingStart.toISOString()} - ${existingEnd.toISOString()})`);
        }
      }
      
      // If there are conflicting tasks, ask user what to do
      if (conflictingTasks.length > 0) {
        console.log(`[SCHEDULER] Found ${conflictingTasks.length} conflicting tasks, asking user for decision`);
        await askUserAboutConflictingTasks(user, task, conflictingTasks, userOffset);
        return; // User will decide via Slack interaction
      }
      
      console.log(`[SCHEDULER] No conflicting tasks found, proceeding with normal scheduling`);

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

      // Check if any available slots are actually adequate for the task duration
      const adequateSlots = available.filter(slot => {
        const slotDuration = slot.end.getTime() - slot.start.getTime();
        return slotDuration >= durationMs;
      });
      
      console.log(`[SCHEDULER] Found ${adequateSlots.length} adequate slots (duration needed: ${durationMs/1000/60} minutes)`);
      
      if (adequateSlots.length === 0) {
        console.log(`[SCHEDULER] No adequate contiguous slots found! Available slots too small for task duration.`);
        console.log(`[SCHEDULER DEBUG] Time range: ${now} to ${deadline}`);
        console.log(`[SCHEDULER DEBUG] Range duration: ${(deadline.getTime() - now.getTime()) / (1000 * 60 * 60)} hours`);
        
        if (available.length > 0) {
          console.log(`[SCHEDULER DEBUG] Found ${available.length} slots but all are too small:`);
          available.forEach((slot, i) => {
            const duration = (slot.end.getTime() - slot.start.getTime()) / (1000 * 60);
            console.log(`[SCHEDULER DEBUG] Slot ${i+1}: ${duration} minutes (need ${durationMs/1000/60})`);
          });
        }
        
        console.log(`[SCHEDULER] Initiating conflict resolution due to insufficient contiguous time for task ${task.id}`);
        const resolved = await handleSchedulingConflicts(user, task, userNow, userDeadline, userOffset);
        if (!resolved) {
          throw new Error(`No adequate slots for task ${task.id} after conflict resolution`);
        }
        continue; // Skip to next task since this one was handled by conflict resolution
      }
      const slot = selectOptimalSlot(
        adequateSlots,
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
 * Handle scheduling conflicts for a task
 */
async function handleSchedulingConflicts(
  user: User,
  incomingTask: Task,
  now: Date,
  deadline: Date,
  userOffset: string
): Promise<boolean> {
  console.log(`[CONFLICT_RESOLUTION] Starting conflict resolution for task ${incomingTask.id}`);
  
  // Get all scheduled tasks
  const scheduledTasks = await storage.getTasksByStatus(user.id, 'scheduled');
  
  // Get external events
  const externalEvents = await getCalendarEvents(user, now, deadline);
  
  // Find conflicts
  const { internalConflicts, externalConflicts } = await findConflicts(
    user,
    incomingTask,
    now,
    deadline,
    scheduledTasks,
    externalEvents,
    userOffset
  );
  
  // If no conflicts found, proceed with normal scheduling
  if (internalConflicts.length === 0 && externalConflicts.length === 0) {
    console.log(`[CONFLICT_RESOLUTION] No conflicts found for task ${incomingTask.id}`);
    return true;
  }
  
  // Update task status to pending conflict resolution
  await storage.updateTaskStatus(incomingTask.id, 'pending_conflict_resolution');
  
  // Send enhanced conflict resolution message
  await sendEnhancedConflictResolutionMessage(
    user,
    incomingTask,
    internalConflicts,
    externalConflicts,
    userOffset
  );
  
  return false;
}

/**
 * Send enhanced conflict resolution message with detailed options
 */
async function sendEnhancedConflictResolutionMessage(
  user: User,
  incomingTask: Task,
  internalConflicts: Array<{
    type: 'internal';
    task?: Task;
    conflictType: 'time' | 'priority' | 'dependency';
    start: Date;
    end: Date;
  }>,
  externalConflicts: Array<{
    type: 'external';
    event?: { start: Date; end: Date; title?: string; eventId?: string };
    conflictType: 'time' | 'priority' | 'dependency';
    start: Date;
    end: Date;
  }>,
  userOffset: string
): Promise<void> {
  if (!user.slackUserId) {
    console.log(`[CONFLICT_RESOLUTION] No Slack user ID found for user ${user.id}`);
    return;
  }
  
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `📅 **Scheduling Conflict**\n\nYour new task **"${incomingTask.title}"** conflicts with:`
      }
    }
  ];
  
  // Add internal conflicts
  if (internalConflicts.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Internal Tasks:*'
      }
    });
    
    for (const conflict of internalConflicts) {
      if (!conflict.task) continue;
      
      const startTime = formatDateWithOffset(conflict.start, userOffset);
      const endTime = formatDateWithOffset(conflict.end, userOffset);
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `• **${conflict.task.title}**\n` +
            `  - Time: ${startTime} - ${endTime}\n` +
            `  - Priority: ${conflict.task.priority}\n` +
            `  - Conflict: ${conflict.conflictType}`
        }
      });
    }
  }
  
  // Add external conflicts
  if (externalConflicts.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*External Events:*'
      }
    });
    
    for (const conflict of externalConflicts) {
      if (!conflict.event) continue;
      
      const startTime = formatDateWithOffset(conflict.start, userOffset);
      const endTime = formatDateWithOffset(conflict.end, userOffset);
      
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `• **${conflict.event.title || 'Untitled Event'}**\n` +
            `  - Time: ${startTime} - ${endTime}`
        }
      });
    }
  }
  
  // Add action buttons
  blocks.push({
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Bump Selected Tasks' },
        style: 'primary',
        action_id: 'bump_selected_tasks',
        value: JSON.stringify({
          taskId: incomingTask.id,
          action: 'bump_selected_tasks',
          internalConflicts: internalConflicts.map((c) => c.task?.id).filter(Boolean),
          externalConflicts: externalConflicts.map((c) => c.event?.eventId).filter(Boolean)
        })
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: 'Schedule at Earliest Available' },
        action_id: 'schedule_earliest',
        value: JSON.stringify({
          taskId: incomingTask.id,
          action: 'schedule_earliest'
        })
      }
    ]
  });
  
  // Add timeout warning
  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: '⚠️ If no action is taken within 30 minutes, the task will be automatically scheduled at the earliest available time.'
      }
    ]
  });
  
  await sendInteractiveMessage(user.slackUserId, { blocks });
  
  // Set timeout for automatic resolution
  setTimeout(async () => {
    const task = await storage.getTask(incomingTask.id);
    if (task?.status === 'pending_conflict_resolution') {
      await scheduleAtEarliestAvailable(user, incomingTask, userOffset);
      await sendMessage(user.slackUserId!, 'Task automatically scheduled at earliest available time due to no response');
    }
  }, 30 * 60 * 1000); // 30 minutes timeout
}

/**
 * Bump selected tasks to new slots
 */
async function bumpSelectedTasks(
  user: User,
  incomingTask: Task,
  taskIdsToBump: number[],
  userOffset: string
): Promise<boolean> {
  const tasksToBump = await Promise.all(
    taskIdsToBump.map(id => storage.getTask(id))
  );
  
  // Sort tasks by priority and dependencies
  const sortedTasks = tasksToBump
    .filter((task): task is Task => task !== null)
    .sort((a: Task, b: Task) => {
      const priorityA = getPriorityValue(a.priority || 'medium');
      const priorityB = getPriorityValue(b.priority || 'medium');
      return priorityA - priorityB;
    });
  
  // Try to bump each task
  for (const task of sortedTasks) {
    const duration = parseDuration(task.timeRequired) ?? 3600000;
    const deadline = computeDeadline(task, new Date(), userOffset);
    
    const newSlot = await findNextAvailableSlot(
      duration,
      { start: new Date(), end: deadline },
      user,
      userOffset
    );
    
    if (!newSlot) {
      // If we can't find a slot, roll back all changes
      await rollbackBumping(user, sortedTasks);
      return false;
    }
    
    // Verify slot is still available
    if (!await isSlotAvailable(newSlot, user)) {
      await rollbackBumping(user, sortedTasks);
      return false;
    }
    
    await storage.updateTask(task.id, {
      scheduledStart: newSlot.start.toISOString(),
      scheduledEnd: newSlot.end.toISOString()
    });
  }
  
  return true;
}

/**
 * Check if a slot is still available
 */
async function isSlotAvailable(
  slot: { start: Date; end: Date },
  user: User
): Promise<boolean> {
  const events = await getCalendarEvents(user, slot.start, slot.end);
  return events.length === 0;
}

/**
 * Roll back bumped tasks to their original slots
 */
async function rollbackBumping(
  user: User,
  tasks: Task[]
): Promise<void> {
  for (const task of tasks) {
    if (task.scheduledStart && task.scheduledEnd) {
      await storage.updateTask(task.id, {
        scheduledStart: task.scheduledStart,
        scheduledEnd: task.scheduledEnd
      });
    }
  }
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
 * Find all conflicts for a task
 */
async function findConflicts(
  user: User,
  incomingTask: Task,
  now: Date,
  deadline: Date,
  scheduledTasks: Task[],
  externalEvents: Array<{ start: Date; end: Date; title?: string; eventId?: string }>,
  userOffset: string
): Promise<{
  internalConflicts: Array<{
    type: 'internal';
    task?: Task;
    conflictType: 'time' | 'priority' | 'dependency';
    start: Date;
    end: Date;
  }>;
  externalConflicts: Array<{
    type: 'external';
    event?: { start: Date; end: Date; title?: string; eventId?: string };
    conflictType: 'time' | 'priority' | 'dependency';
    start: Date;
    end: Date;
  }>;
}> {
  const internalConflicts: Array<{
    type: 'internal';
    task?: Task;
    conflictType: 'time' | 'priority' | 'dependency';
    start: Date;
    end: Date;
  }> = [];
  
  const externalConflicts: Array<{
    type: 'external';
    event?: { start: Date; end: Date; title?: string; eventId?: string };
    conflictType: 'time' | 'priority' | 'dependency';
    start: Date;
    end: Date;
  }> = [];
  
  // Check internal task conflicts
  for (const task of scheduledTasks) {
    if (!task.scheduledStart || !task.scheduledEnd) continue;
    
    const taskStart = new Date(task.scheduledStart);
    const taskEnd = new Date(task.scheduledEnd);
    
    // Check time overlap
    if (now < taskEnd && deadline > taskStart) {
      internalConflicts.push({
        type: 'internal',
        task,
        conflictType: 'time',
        start: taskStart,
        end: taskEnd
      });
    }
    
    // Check priority conflicts
    const taskPriority = getPriorityValue(task.priority || 'medium');
    const incomingPriority = getPriorityValue(incomingTask.priority || 'medium');
    if (taskPriority < incomingPriority) {
      internalConflicts.push({
        type: 'internal',
        task,
        conflictType: 'priority',
        start: taskStart,
        end: taskEnd
      });
    }
  }
  
  // Check external event conflicts
  for (const event of externalEvents) {
    if (now < event.end && deadline > event.start) {
      externalConflicts.push({
        type: 'external',
        event,
        conflictType: 'time',
        start: event.start,
        end: event.end
      });
    }
  }
  
  return { internalConflicts, externalConflicts };
}

/**
 * Schedule task at earliest available time
 */
async function scheduleAtEarliestAvailable(
  user: User,
  task: Task,
  userOffset: string
): Promise<void> {
  const duration = parseDuration(task.timeRequired) ?? 3600000;
  const deadline = computeDeadline(task, new Date(), userOffset);
  
  // Find next available slot
  const slot = await findNextAvailableSlot(
    duration,
    { start: new Date(), end: deadline },
    user,
    userOffset
  );
  
  if (slot) {
    await scheduleTaskInSlot(user, task, slot, userOffset);
    await sendMessage(
      user.slackUserId!,
      `Task "${task.title}" has been scheduled at ${formatDateWithOffset(slot.start, userOffset)}`
    );
  } else {
    await sendMessage(
      user.slackUserId!,
      `Could not find an available slot for task "${task.title}" before its deadline. Please schedule manually.`
    );
  }
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
