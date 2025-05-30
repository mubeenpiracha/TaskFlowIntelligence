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

    // Get all users and process their tasks
    const allUsers = await storage.getAllUsers();
    console.log(`[SCHEDULER] Processing tasks for ${allUsers.length} users`);

    for (const user of allUsers) {
      // Skip users without Google Calendar integration
      if (!user.googleRefreshToken || user.googleRefreshToken.trim() === '') {
        console.log(`[SCHEDULER] Skipping user ${user.id} - no Google Calendar integration`);
        continue;
      }

      try {
        const tasks = await storage.getTasksByStatus(user.id, "accepted");
        console.log(
          `[SCHEDULER] Found ${tasks.length} unscheduled tasks for user ${user.id}`,
        );

        if (tasks.length) {
          console.log(`[SCHEDULER] Processing ${tasks.length} tasks for user ${user.id}`);
          await scheduleTasksForUser(user, tasks);
        }
      } catch (userError: any) {
        console.error(`[SCHEDULER] Error processing tasks for user ${user.id}:`, userError.message);
        // Continue with other users even if one fails
        continue;
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
      const userNow = now;
      const userDeadline = deadline;

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
        console.log(
          `[SCHEDULER] No available slots found for task ${task.id}, initiating conflict resolution`,
        );

        // Calculate required start time (deadline - task duration)
        const requiredStartTime = new Date(deadline.getTime() - durationMs);

        // Try conflict resolution
        const { handleSchedulingConflict } = await import("./conflictResolver");
        const conflictHandled = await handleSchedulingConflict(
          user,
          task,
          requiredStartTime,
          deadline,
          durationMs,
        );

        if (conflictHandled) {
          console.log(
            `[SCHEDULER] Conflict resolution initiated for task ${task.id}`,
          );
          continue; // Skip to next task, this one will be handled by conflict resolution
        } else {
          console.log(
            `[SCHEDULER] Conflict resolution failed for task ${task.id}, marking for manual scheduling`,
          );
          await storage.updateTask(task.id, {
            status: "pending_manual_schedule",
          });
          continue;
        }
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

function parseBusySlots(ev: any): Array<{ start: Date; end: Date }> {
  // prefer the dateTime field if present, else date
  const startStr = ev.start?.dateTime ?? ev.start?.date;
  const endStr = ev.end?.dateTime ?? ev.end?.date;
  if (!startStr || !endStr) return [];

  return [
    {
      start: new Date(startStr),
      end: new Date(endStr),
    },
  ];
}
/**
 * Convert calendar event into busy slot(s)
 */

/**
 * Find free slots between now and end, avoiding busy slots and respecting working hours
 */
async function findAvailableSlots(
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
