/**
 * Task scheduler service that processes unscheduled tasks
 * and creates calendar events for them
 */
import { storage } from "../storage";
import { createEvent, getCalendarEvents } from "./calendarService";
import { User, Task } from "@shared/schema";
import {
  addHours,
  addMinutes,
  parse,
  format,
  isWithinInterval,
} from "date-fns";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";
import { handleCalendarTokenExpiration } from "./calendarReconnect";
import { formatDateForGoogleCalendar } from "../utils/dateUtils";

// Run interval in milliseconds (check every 30 seconds)
const SCHEDULE_INTERVAL = 30 * 1000;

// Scheduling is in progress flag to prevent concurrent runs
let isRunning = false;

/**
 * Start the task scheduler service
 */
export function startScheduler() {
  console.log("[SCHEDULER] Starting automatic task scheduler service");

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
    console.log("[SCHEDULER] Scheduler already running, skipping this run");
    return;
  }

  isRunning = true;

  try {
    console.log("[SCHEDULER] Checking for unscheduled tasks...");

    // Currently using a single user with ID 1 until schema migration is complete
    const user = await storage.getUser(1);

    if (user) {
      // Process just this user as a compatibility measure
      if (!user.googleRefreshToken) {
        console.log(
          `[SCHEDULER] User ${user.id} doesn't have Google Calendar connected, skipping`,
        );
      } else {
        // Get tasks that are accepted but not scheduled yet
        const unscheduledTasks = await storage.getTasksByStatus(
          user.id,
          "accepted",
        );
        console.log(
          `[SCHEDULER] Found ${unscheduledTasks.length} unscheduled tasks for user ${user.id}`,
        );

        if (unscheduledTasks.length > 0) {
          try {
            await scheduleTasksForUser(user, unscheduledTasks);
          } catch (err: any) {
            if (err.message && err.message.includes("No available slots")) {
              console.error("[SCHEDULER] Out of slots:", err.message);
              // TODO: mark task(s) for manual scheduling or notify the user
            } else {
              throw err;
            }
          }
        }
      }
    }

    console.log("[SCHEDULER] Finished checking for unscheduled tasks");
  } catch (error) {
    console.error("[SCHEDULER] Error in scheduler:", error);
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
  console.log(
    `[SCHEDULER] Processing ${tasks.length} tasks for user ${user.id}`,
  );

  for (const task of tasks) {
    try {
      // Skip if already has a Google Event ID
      if (task.googleEventId) {
        console.log(
          `[SCHEDULER] Task ${task.id} already has a Google Calendar event (${task.googleEventId}), skipping`,
        );
        continue;
      }

      console.log(`[SCHEDULER] Scheduling task ${task.id}: ${task.title}`);

      // User's timezone
      const userTimezone = user.timezone || "UTC";

      // Determine time required for the task
      let taskDurationMs = 3600000; // 1 hour default
      if (
        task.timeRequired &&
        typeof task.timeRequired === "string" &&
        task.timeRequired.includes(":")
      ) {
        try {
          const [hours, minutes] = task.timeRequired.split(":").map((n) => {
            const parsed = parseInt(n, 10);
            return isNaN(parsed) ? 0 : parsed;
          });

          // Ensure we have valid numbers
          const validHours = isNaN(hours) ? 0 : hours;
          const validMinutes = isNaN(minutes) ? 0 : minutes;

          taskDurationMs =
            validHours * 60 * 60 * 1000 + validMinutes * 60 * 1000;
        } catch (e) {
          console.error(
            `[SCHEDULER] Error parsing task.timeRequired: ${task.timeRequired}`,
            e,
          );
        }
      }

      if (taskDurationMs <= 0) {
        taskDurationMs = 3600000; // Fallback to 1 hour
      }

      // Get deadline from dueDate and dueTime if available
      let deadline = new Date();
      deadline.setDate(deadline.getDate() + 7); // Default 7 days from now

      if (task.dueDate) {
        const dueDateObj = new Date(task.dueDate);

        // If dueTime is also available, use it for precise time
        if (task.dueTime) {
          const [hours, minutes] = task.dueTime.split(":").map(Number);
          dueDateObj.setHours(hours || 17, minutes || 0, 0, 0); // Default to 5:00 PM if time parsing fails
        } else {
          // Default end of day if only date is provided
          dueDateObj.setHours(17, 0, 0, 0);
        }

        deadline = dueDateObj;
      } else if (task.priority === "high") {
        deadline.setDate(deadline.getDate() + 1); // High priority: 1 day
      } else if (task.priority === "medium") {
        deadline.setDate(deadline.getDate() + 3); // Medium priority: 3 days
      } else {
        deadline.setDate(deadline.getDate() + 7); // Low priority: 7 days
      }

      // Get user's working hours (if any)
      let workingHours = await storage.getWorkingHours(user.id);

      // Default working hours if none are set
      if (!workingHours) {
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
          startTime: "09:00",
          endTime: "17:00",
          breakStartTime: null,
          breakEndTime: null,
          focusTimeEnabled: false,
          focusTimeDuration: null,
          focusTimePreference: null,
        };
      }

      // Get the start date for calendar query
      const now = new Date();

      // Widen the busy-slot query window by looking back by the task duration
      // This ensures we catch meetings that started before now but are still ongoing
      const lookbackMs = taskDurationMs;
      const queryStart = new Date(now.getTime() - lookbackMs);

      // End date for calendar query is the deadline
      const endDate = new Date(deadline);

      console.log(
        `[SCHEDULER] Fetching calendar events from ${queryStart.toISOString()} to ${endDate.toISOString()}`,
      );

      // Fetch existing calendar events including those that started before now but are still ongoing
      let existingEvents: Array<any> = [];
      try {
        existingEvents = await getCalendarEvents(user, queryStart, endDate);
        console.log(
          `[SCHEDULER] Found ${existingEvents.length} existing events in calendar`,
        );
      } catch (error: any) {
        console.error(
          `[SCHEDULER] Error fetching calendar events: ${error.message}`,
        );
        existingEvents = [];
      }

      // Convert existing events to busy time slots
      const busySlots: Array<{ start: Date; end: Date }> = [];

      for (const event of existingEvents) {
        // Use native Date handling for events
        const start = event.start?.dateTime
          ? new Date(event.start.dateTime)
          : null;
        const end = event.end?.dateTime ? new Date(event.end.dateTime) : null;

        if (start && end) {
          busySlots.push({ start, end });
          console.log(
            `[SCHEDULER] Added busy slot: ${start.toISOString()} - ${end.toISOString()}`,
          );
        }
      }

      console.log(
        `[SCHEDULER] Converted ${busySlots.length} events to busy slots`,
      );

      // Find available slots
      const availableSlots = findAvailableSlots(
        now,
        endDate,
        busySlots,
        taskDurationMs,
        workingHours,
        userTimezone,
      );

      console.log(`[SCHEDULER] Found ${availableSlots.length} available slots`);

      // If we couldn't find any available slots, throw an error instead of defaulting to a fallback
      // This prevents overlapping appointments that would create schedule conflicts
      if (availableSlots.length === 0) {
        throw new Error(
          `No available slots for task ${task.id} before deadline`,
        );
      }

      // Select the best slot based on task priority and deadline
      const optimalSlot = selectOptimalSlot(
        availableSlots,
        task.priority || "medium",
        deadline,
        now,
      );

      console.log(
        `[SCHEDULER] Selected optimal slot: ${optimalSlot.start.toISOString()} - ${optimalSlot.end.toISOString()}`,
      );

      // Format dates with proper timezone for Google Calendar
      const startDateTime = formatDateForGoogleCalendar(
        optimalSlot.start,
        userTimezone,
      );
      const endDateTime = formatDateForGoogleCalendar(
        optimalSlot.end,
        userTimezone,
      );

      // Create event data with the optimal slot
      const eventData = {
        summary: task.title,
        description: task.description || undefined,
        start: {
          dateTime: startDateTime,
          timeZone: userTimezone,
        },
        end: {
          dateTime: endDateTime,
          timeZone: userTimezone,
        },
      };

      // Schedule the task with the event data
      await scheduleTaskWithEventData(user, task, eventData);
    } catch (error: any) {
      console.error(
        `[SCHEDULER] Error scheduling task ${task.id}:`,
        error.message,
      );

      // If this is a token expiration error, notify the user
      if (
        error.name === "TokenExpiredError" ||
        (error.message &&
          error.message.includes("token") &&
          (error.message.includes("expired") ||
            error.message.includes("revoked")))
      ) {
        try {
          // Use the imported function to handle token expiration
          await handleCalendarTokenExpiration(user.id, {
            id: task.id,
            title: task.title,
          });

          console.log(
            `[SCHEDULER] Sent calendar reconnection notification to user ${user.id}`,
          );
        } catch (notifyError) {
          console.error(
            `[SCHEDULER] Error sending calendar reconnection notification: ${notifyError}`,
          );
        }
      }

      // Propagate the error up
      throw error;
    }
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
  busySlots: Array<{ start: Date; end: Date }>,
  taskDurationMs: number,
  workingHours: any,
  timezone: string,
): Array<{ start: Date; end: Date }> {
  const availableSlots: Array<{ start: Date; end: Date }> = [];

  // Define which days of the week are working days
  const workingDays = [
    workingHours.sunday,
    workingHours.monday,
    workingHours.tuesday,
    workingHours.wednesday,
    workingHours.thursday,
    workingHours.friday,
    workingHours.saturday,
  ];

  // Parse working hours
  const [startHour, startMinute] = workingHours.startTime
    .split(":")
    .map(Number);
  const [endHour, endMinute] = workingHours.endTime.split(":").map(Number);

  console.log(
    `[SCHEDULER] Working hours: ${startHour}:${startMinute} - ${endHour}:${endMinute}`,
  );
  console.log(
    `[SCHEDULER] Working days: ${workingDays
      .map((day, index) => (day ? index : null))
      .filter((day) => day !== null)
      .join(", ")}`,
  );

  // Log that we're finding slots in the user's timezone
  console.log(`[SCHEDULER] Finding available slots in timezone: ${timezone}`);
  
  // Convert startDate to the user's timezone
  let currentDate = toZonedTime(startDate, timezone);
  const mins = currentDate.getMinutes();
  const rounded = Math.ceil(mins / 15) * 15;
  currentDate.setMinutes(rounded, 0, 0);

  // Ensure we're not scheduling in the past (also in user's timezone)
  const now = toZonedTime(new Date(), timezone);
  if (currentDate < now) {
    console.log(
      `[SCHEDULER] Adjusted start time from past (${format(currentDate, "yyyy-MM-dd'T'HH:mm:ssXXX")}) to now (${format(now, "yyyy-MM-dd'T'HH:mm:ssXXX")})`,
    );
    currentDate = new Date(now);
    // Round up to the nearest 15-minute interval
    const minutes = currentDate.getMinutes();
    const roundedMinutes = Math.ceil(minutes / 15) * 15;
    currentDate.setMinutes(roundedMinutes, 0, 0);
  }

  // Buffer time to prevent back-to-back meetings (10 minutes)
  const bufferMs = 10 * 60 * 1000;

  // Generate potential slots during working hours at 15-minute intervals
  while (currentDate < endDate) {
    const dayOfWeek = currentDate.getDay(); // 0 = Sunday, 1 = Monday, etc.

    // Skip non-working days
    if (!workingDays[dayOfWeek]) {
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(startHour, startMinute, 0, 0);
      continue;
    }

    // Get the current time elements
    const currentHour = currentDate.getHours();
    const currentMinute = currentDate.getMinutes();

    // Skip if before working hours (move to next slot, don't force to start of day)
    if (
      currentHour < startHour ||
      (currentHour === startHour && currentMinute < startMinute)
    ) {
      // Move to next 15-minute increment
      currentDate = new Date(currentDate.getTime() + 15 * 60 * 1000);
      continue;
    }

    // Skip if after working hours
    if (
      currentHour > endHour ||
      (currentHour === endHour && currentMinute >= endMinute)
    ) {
      // Move to next day at start of working hours
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(startHour, startMinute, 0, 0);
      continue;
    }

    // Calculate slot end time
    const slotEnd = new Date(currentDate.getTime() + taskDurationMs);

    // Skip if slot end is after working hours
    if (
      slotEnd.getHours() > endHour ||
      (slotEnd.getHours() === endHour && slotEnd.getMinutes() > endMinute)
    ) {
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
      currentDate.setHours(startHour, startMinute, 0, 0);
      continue;
    }

    // Skip if slot overlaps the user's break
    if (workingHours.breakStartTime && workingHours.breakEndTime) {
      const [bStartH, bStartM] = workingHours.breakStartTime
        .split(":")
        .map(Number);
      const [bEndH, bEndM] = workingHours.breakEndTime.split(":").map(Number);
      const breakStart = new Date(currentDate);
      breakStart.setHours(bStartH, bStartM, 0);
      const breakEnd = new Date(currentDate);
      breakEnd.setHours(bEndH, bEndM, 0);

      if (currentDate < breakEnd && slotEnd > breakStart) {
        // Move to next 15-minute increment
        currentDate = new Date(currentDate.getTime() + 15 * 60 * 1000);
        continue;
      }
    }

    // Check if the slot overlaps with any busy slots
    const slotStartMs = currentDate.getTime();
    const slotEndMs = slotEnd.getTime();

    // Log the slot we're checking with timezone-specific format
    console.log(
      `[SCHEDULER] Checking slot in ${timezone}: ${formatInTimeZone(new Date(slotStartMs), timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")} - ${formatInTimeZone(new Date(slotEndMs), timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")}`,
    );

    let isOverlapping = false;

    // Check against all busy slots
    for (const busySlot of busySlots) {
      const busyStartMs = busySlot.start.getTime();
      const busyEndMs = busySlot.end.getTime();

      // Apply buffer to both ends of busy slots
      const busyStartWithBuffer = busyStartMs - bufferMs;
      const busyEndWithBuffer = busyEndMs + bufferMs;

      // Comprehensive overlap check:
      // 1. Slot starts during busy period (including buffer), or
      // 2. Slot ends during busy period (including buffer), or
      // 3. Slot completely contains busy period (including buffer), or
      // 4. Busy period completely contains slot
      const overlaps =
        (slotStartMs >= busyStartWithBuffer &&
          slotStartMs < busyEndWithBuffer) || // Slot starts during busy
        (slotEndMs > busyStartWithBuffer && slotEndMs <= busyEndWithBuffer) || // Slot ends during busy
        (slotStartMs <= busyStartWithBuffer &&
          slotEndMs >= busyEndWithBuffer) || // Slot contains busy
        (busyStartWithBuffer <= slotStartMs && busyEndWithBuffer >= slotEndMs); // Busy contains slot

      if (overlaps) {
        // Enhanced debug logging with timezone-specific formatting
        console.log(
          `[SCHEDULER] ⚠️ CONFLICT DETECTED in ${timezone}: ` +
          `Slot ${formatInTimeZone(new Date(slotStartMs), timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")} - ${formatInTimeZone(new Date(slotEndMs), timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")} ` +
          `overlaps with busy slot ${formatInTimeZone(new Date(busyStartMs), timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")} - ${formatInTimeZone(new Date(busyEndMs), timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")}`,
        );
        isOverlapping = true;
        break;
      }
    }

    // If no overlaps, this is a valid slot
    if (!isOverlapping) {
      availableSlots.push({
        start: new Date(currentDate),
        end: new Date(slotEnd),
      });
      console.log(
        `[SCHEDULER] ✅ Valid slot found in ${timezone}: ${formatInTimeZone(currentDate, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")} - ${formatInTimeZone(slotEnd, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX")}`,
      );
    }

    // Move to next 15-minute increment
    currentDate = new Date(currentDate.getTime() + 15 * 60 * 1000);
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
  availableSlots: Array<{ start: Date; end: Date }>,
  priority: string,
  deadline: Date,
  now: Date,
): { start: Date; end: Date } {
  if (availableSlots.length === 0) {
    throw new Error("No available slots to select from");
  }

  // Sort slots by start time (chronological order)
  const sortedSlots = [...availableSlots].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );

  // For high priority tasks, pick earliest slot
  if (priority === "high") {
    console.log(
      "[SCHEDULER] High priority task, selecting earliest available slot",
    );
    return sortedSlots[0];
  }

  // For low priority tasks, aim for later slots unless close to deadline
  if (priority === "low") {
    const daysUntilDeadline =
      (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    if (daysUntilDeadline > 5) {
      // If more than 5 days until deadline, push it back
      const laterIndex = Math.min(
        sortedSlots.length - 1,
        Math.floor(sortedSlots.length * 0.7),
      );
      console.log(
        `[SCHEDULER] Low priority task with ${daysUntilDeadline.toFixed(1)} days until deadline, selecting later slot`,
      );
      return sortedSlots[laterIndex];
    }
  }

  // For medium priority or low priority close to deadline, pick a balanced slot
  const timeUntilDeadline = deadline.getTime() - now.getTime();

  // Find a slot at approximately 1/3 of the way to the deadline for balanced scheduling
  const targetTime = now.getTime() + timeUntilDeadline / 3;

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

  console.log(
    "[SCHEDULER] Selected optimal slot based on priority and deadline",
  );
  return closestSlot;
}

/**
 * Helper function to schedule a task with given event data
 */
async function scheduleTaskWithEventData(
  user: User,
  task: Task,
  eventData: any,
) {
  try {
    console.log(
      `[SCHEDULER] Creating Google Calendar event for task ${task.id} with data:`,
      JSON.stringify(eventData, null, 2),
    );

    // Create event in Google Calendar
    const calendarEvent = await createEvent(user, eventData);

    if (!calendarEvent || !calendarEvent.id) {
      throw new Error("Failed to create calendar event: no event ID returned");
    }

    // Update task in storage with Google Calendar event ID and status
    const updatedTask = await storage.updateTask(task.id, {
      googleEventId: calendarEvent.id,
      status: "scheduled",
      scheduledStart: eventData.start.dateTime,
      scheduledEnd: eventData.end.dateTime,
    });

    console.log(
      `[SCHEDULER] Task ${task.id} scheduled successfully with event ID ${calendarEvent.id}`,
    );

    return updatedTask;
  } catch (error: any) {
    console.error(
      `[SCHEDULER] Error creating calendar event for task ${task.id}:`,
      error,
    );
    throw error;
  }
}
