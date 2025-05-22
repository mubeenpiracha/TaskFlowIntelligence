/**
 * Task scheduler service that processes unscheduled tasks
 * and creates calendar events for them
 */
import { storage } from "../storage";
import { createEvent, getCalendarEvents } from "./calendarService";
import { User, Task } from "@shared/schema";
import { addMinutes } from "date-fns";
import { toZonedTime, utcToZonedTime, formatInTimeZone } from "date-fns-tz";
import { handleCalendarTokenExpiration } from "./calendarReconnect";
import { formatDateForGoogleCalendar } from "../utils/dateUtils";

const SCHEDULE_INTERVAL = 30 * 1000;
let isRunning = false;

export function startScheduler() {
  console.log("[SCHEDULER] Starting...");
  scheduleUnscheduledTasks();
  setInterval(scheduleUnscheduledTasks, SCHEDULE_INTERVAL);
}

async function scheduleUnscheduledTasks() {
  if (isRunning) return;
  isRunning = true;
  try {
    console.log("[SCHEDULER] Checking unscheduled tasks...");
    const user = await storage.getUser(1);
    if (!user?.googleRefreshToken) return;
    const tasks = await storage.getTasksByStatus(user.id, "accepted");
    if (tasks.length) {
      try {
        await scheduleTasksForUser(user, tasks);
      } catch (err: any) {
        if (err.message.includes("No available slots")) {
          console.error("[SCHEDULER] Out of slots:", err.message);
          // mark manual
        } else throw err;
      }
    }
  } catch (e) {
    console.error("[SCHEDULER] Error:", e);
  } finally {
    isRunning = false;
  }
}

async function scheduleTasksForUser(user: User, tasks: Task[]) {
  const tz = user.timezone || "UTC";
  for (const task of tasks) {
    if (task.googleEventId) continue;
    try {
      const durationMs = parseDuration(task.timeRequired) || 60 * 60 * 1000;
      const nowUtc = new Date();
      const now = utcToZonedTime(nowUtc, tz);
      const deadline = computeDeadline(task, now);
      const lookback = durationMs;
      const queryStartUtc = new Date(nowUtc.getTime() - lookback);
      const queryEndUtc = deadline;

      const events = await getCalendarEvents(user, queryStartUtc, queryEndUtc);
      const busySlots = events
        .map(ev => normalizeEventSlot(ev, tz))
        .flat();

      const slots = findAvailableSlots(now, deadline, busySlots, durationMs, user, tz);
      if (!slots.length) throw new Error(`No available slots for task ${task.id}`);

      const slot = selectOptimalSlot(slots, task.priority || "medium", deadline, now);
      const startIso = formatDateForGoogleCalendar(slot.start, tz);
      const endIso = formatDateForGoogleCalendar(slot.end, tz);
      const eventData = {
        summary: task.title,
        description: task.description,
        start: { dateTime: startIso, timeZone: tz },
        end:   { dateTime: endIso,   timeZone: tz }
      };
      await scheduleTaskWithEventData(user, task, eventData);
    } catch (e: any) {
      console.error(`[SCHEDULER] Task ${task.id} error:`, e.message);
      if (e.name === 'TokenExpiredError' || /token.*(expired|revoked)/.test(e.message)) {
        await handleCalendarTokenExpiration(user.id, { id: task.id, title: task.title });
      }
    }
  }
}

function parseDuration(str?: string): number | null {
  if (!str) return null;
  const parts = str.split(':').map(n => parseInt(n, 10));
  if (parts.length !== 2) return null;
  const [h, m] = parts;
  if (isNaN(h) || isNaN(m)) return null;
  return h * 3600000 + m * 60000;
}

function computeDeadline(task: Task, now: Date): Date {
  const dl = new Date(now);
  // default
  const addDays = task.priority === 'high' ? 1 : task.priority === 'medium' ? 3 : 7;
  dl.setDate(dl.getDate() + addDays);
  if (task.dueDate) {
    const due = new Date(task.dueDate);
    if (task.dueTime) {
      const [h, m] = task.dueTime.split(':').map(Number);
      due.setHours(h, m, 0, 0);
    } else due.setHours(17, 0, 0, 0);
    return due;
  }
  return dl;
}

function normalizeEventSlot(ev: any, tz: string): Array<{ start: Date; end: Date }> {
  if (ev.start.date) {
    const day = new Date(ev.start.date);
    const start = toZonedTime(day, tz);
    const end   = addMinutes(start, 24 * 60 - 1);
    return [{ start, end }];
  }
  if (ev.start.dateTime && ev.end.dateTime) {
    return [{ start: toZonedTime(new Date(ev.start.dateTime), tz),
              end:   toZonedTime(new Date(ev.end.dateTime),   tz) }];
  }
  return [];
}

function findAvailableSlots(
  now: Date,
  end: Date,
  busy: Array<{ start: Date; end: Date }>,
  dur: number,
  user: User,
  tz: string
): Array<{ start: Date; end: Date }> {
  const wk = await storage.getWorkingHours(user.id) || defaultHours(user.id);
  const days = [wk.sunday, wk.monday, wk.tuesday, wk.wednesday, wk.thursday, wk.friday, wk.saturday];
  const [sh, sm] = wk.startTime.split(':').map(Number);
  const [eh, em] = wk.endTime.split(':').map(Number);
  const buffer = 5 * 60 * 1000;

  const slots: Array<{ start: Date; end: Date }> = [];
  let cur = toZonedTime(now, tz);
  // round to 15m
  const roundM = Math.ceil(cur.getMinutes()/15)*15;
  cur.setMinutes(roundM,0,0);

  while (cur < end) {
    const dow = cur.getDay();
    if (!days[dow]) { cur = nextDay(cur, sh, sm); continue; }
    const ch = cur.getHours(), cm = cur.getMinutes();
    if (ch < sh || (ch===sh&&cm<sm)) { cur = addMinutes(cur,15); continue; }
    if (ch>eh || (ch===eh&&cm>=em)) { cur = nextDay(cur, sh, sm); continue; }
    const endSlot = addMinutes(cur, dur/60000);
    if (endSlot.getHours()>eh || (endSlot.getHours()===eh&&endSlot.getMinutes()>em)) { cur=nextDay(cur,sh,sm); continue; }
    // break
    if (wk.breakStartTime && wk.breakEndTime) {
      const bs = setTime(cur, ...wk.breakStartTime.split(':').map(Number));
      const be = setTime(cur, ...wk.breakEndTime.split(':').map(Number));
      if (cur < be && endSlot > bs) { cur=addMinutes(cur,15); continue; }
    }
    // overlap
    const startMs=cur.getTime(), endMs=endSlot.getTime();
    const conflict = busy.some(b => {
      const bstart=b.start.getTime()-buffer, bend=b.end.getTime()+buffer;
      return (startMs<bend && endMs>bstart);
    });
    if (!conflict) slots.push({ start: new Date(cur), end: new Date(endSlot) });
    cur = addMinutes(cur,15);
  }
  return slots;
}

function nextDay(d: Date, h: number, m: number) {
  const nd = new Date(d);
  nd.setDate(nd.getDate()+1);
  nd.setHours(h,m,0,0);
  return nd;
}

function setTime(d: Date, h: number, m: number) {
  const t = new Date(d);
  t.setHours(h,m,0,0);
  return t;
}

function defaultHours(userId: number) {
  return { id:0,userId,monday:true,tuesday:true,wednesday:true,thursday:true,friday:true,saturday:false,sunday:false,startTime:"09:00",endTime:"17:00",breakStartTime:null,breakEndTime:null,focusTimeEnabled:false,focusTimeDuration:null,focusTimePreference:null };
}

function selectOptimalSlot(
  slots: Array<{ start: Date; end: Date }>,
  pr: string,
  dl: Date,
  now: Date
) {
  if (!slots.length) throw new Error("No available slots to select from");
  slots.sort((a,b)=>a.start.getTime()-b.start.getTime());
  if (pr==='high') return slots[0];
  if (pr==='low') {
    const days=(dl.getTime()-now.getTime())/(86400000);
    if (days>5) return slots[Math.floor(slots.length*0.7)];
  }
  const target = now.getTime() + (dl.getTime()-now.getTime())/3;
  let best=slots[0], dist=Math.abs(slots[0].start.getTime()-target);
  for (const s of slots) {
    const d=Math.abs(s.start.getTime()-target);
    if (d<dist) { best=s; dist=d; }
  }
  return best;
}

async function scheduleTaskWithEventData(user: User, task: Task, data: any) {
  const ev = await createEvent(user, data);
  if (!ev?.id) throw new Error('Calendar event failed');
  await storage.updateTask(task.id, {
    googleEventId: ev.id,
    scheduledStart: data.start.dateTime,
    scheduledEnd:   data.end.dateTime,
    status: 'scheduled'
  });
  console.log(`[SCHEDULER] Task ${task.id} -> event ${ev.id}`);
}
