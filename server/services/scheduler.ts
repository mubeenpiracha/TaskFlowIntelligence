/**
 * Task scheduler service that processes unscheduled tasks
 * and creates calendar events for them
 */
import { storage } from "../storage";
import { createEvent, getCalendarEvents } from "./calendarService";
import { User, Task } from "@shared/schema";
import { addMinutes } from "date-fns";
import { handleCalendarTokenExpiration } from "./calendarReconnect";
import { formatDateWithOffset, convertToUserTimezone } from "../utils/offsetUtils";

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
    console.log(
      `[SCHEDULER] Found ${tasks.length} unscheduled tasks for user ${user.id}`,
    );

    if (tasks.length) {
      try {
        await scheduleTasksForUser(user, tasks);
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

      const deadline = computeDeadline(task, now);
      console.log(`[SCHEDULER DEBUG] Computed deadline: ${deadline}`);

      // Extend busy query window to catch events that started before now
      const queryStart = new Date(now.getTime() - durationMs);
      const queryEnd = deadline;

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
      const busySlots = events.flatMap((ev) => normalizeEventSlot(ev));
      console.log(`[SCHEDULER] ${busySlots.length} busy slots loaded`);

      console.log(`[SCHEDULER DEBUG] Calling findAvailableSlots with:`);
      console.log(`[SCHEDULER DEBUG] - now: ${now}`);
      console.log(`[SCHEDULER DEBUG] - deadline: ${deadline}`);
      console.log(`[SCHEDULER DEBUG] - busySlots count: ${busySlots.length}`);
      console.log(`[SCHEDULER DEBUG] - durationMs: ${durationMs}`);
      console.log(`[SCHEDULER DEBUG] - userId: ${user.id}`);

      const available = await findAvailableSlots(
        now,
        deadline,
        busySlots,
        durationMs,
        user.id,
      );
      console.log(`[SCHEDULER] Found ${available.length} available slots`);

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

      if (!available.length)
        throw new Error(`No available slots for task ${task.id}`);
      const slot = selectOptimalSlot(
        available,
        task.priority ?? "medium",
        deadline,
        now,
      );
      console.log(`[SCHEDULER] Chosen slot: ${slot.start} - ${slot.end}`);

      // Use the much simpler offset-based formatting instead of complex IANA timezone handling
      const userOffset = user.timezoneOffset || '+00:00';
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
function computeDeadline(task: Task, now: Date): Date {
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
    const d = new Date(task.dueDate);
    console.log(`[DEADLINE DEBUG] Parsed dueDate: ${d}`);

    if (task.dueTime) {
      console.log(`[DEADLINE DEBUG] Task has dueTime: ${task.dueTime}`);
      const [h, m] = task.dueTime.split(":").map(Number);
      console.log(`[DEADLINE DEBUG] Parsed time: ${h}:${m}`);
      d.setHours(h, m, 0, 0);
      console.log(`[DEADLINE DEBUG] Final deadline with time: ${d}`);
    } else {
      d.setHours(17, 0, 0, 0);
      console.log(`[DEADLINE DEBUG] Final deadline (default 5pm): ${d}`);
    }
    console.log(`[DEADLINE DEBUG] Returning dueDate-based deadline: ${d}`);
    return d;
  }
  console.log(`[DEADLINE DEBUG] Returning priority-based deadline: ${dl}`);
  return dl;
}

/**
 * Convert calendar event into busy slot(s)
 */
function normalizeEventSlot(ev: any): Array<{ start: Date; end: Date }> {
  // Add null checking to prevent "Cannot read properties of undefined" errors
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

/**
 * Find free slots between now and end, avoiding busy slots and respecting working hours
 */
async function findAvailableSlots(
  now: Date,
  end: Date,
  busy: Array<{ start: Date; end: Date }>,
  dur: number,
  userId: number,
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
  const [sh, sm] = wk.startTime.split(":").map(Number);
  const [eh, em] = wk.endTime.split(":").map(Number);
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
    const conflict = busy.some(
      (b) =>
        startMs < b.end.getTime() + bufferMs &&
        endMs > b.start.getTime() - bufferMs,
    );
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
