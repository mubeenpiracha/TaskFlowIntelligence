import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull(),
  slackUserId: text("slack_user_id"),
  slackAccessToken: text("slack_access_token"),
  googleRefreshToken: text("google_refresh_token"),
  slackWorkspace: text("slack_workspace"),
  slackChannelPreferences: text("slack_channel_preferences"),
});

export const workingHours = pgTable("working_hours", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  monday: boolean("monday").notNull().default(true),
  tuesday: boolean("tuesday").notNull().default(true),
  wednesday: boolean("wednesday").notNull().default(true),
  thursday: boolean("thursday").notNull().default(true),
  friday: boolean("friday").notNull().default(true),
  saturday: boolean("saturday").notNull().default(false),
  sunday: boolean("sunday").notNull().default(false),
  startTime: text("start_time").notNull().default("09:00"),
  endTime: text("end_time").notNull().default("17:00"),
  breakStartTime: text("break_start_time").default("12:00"),
  breakEndTime: text("break_end_time").default("13:00"),
  focusTimeEnabled: boolean("focus_time_enabled").default(true),
  focusTimeDuration: text("focus_time_duration").default("01:00"),
  focusTimePreference: text("focus_time_preference").default("morning"),
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("medium"),
  timeRequired: text("time_required").notNull().default("01:00"),
  dueDate: text("due_date"),
  dueTime: text("due_time"),
  completed: boolean("completed").notNull().default(false),
  slackMessageId: text("slack_message_id"),
  slackChannelId: text("slack_channel_id"),
  googleEventId: text("google_event_id"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // New fields for scheduling
  scheduledStart: text("scheduled_start"),
  scheduledEnd: text("scheduled_end"),
  // Fields for task analytics
  importance: integer("importance"),
  urgency: integer("urgency"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
  slackUserId: true,
  slackAccessToken: true,
  googleRefreshToken: true,
  slackWorkspace: true,
  slackChannelPreferences: true,
});

export const insertWorkingHoursSchema = createInsertSchema(workingHours).pick({
  userId: true,
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: true,
  sunday: true,
  startTime: true,
  endTime: true,
  breakStartTime: true,
  breakEndTime: true,
  focusTimeEnabled: true,
  focusTimeDuration: true,
  focusTimePreference: true,
});

export const insertTaskSchema = createInsertSchema(tasks).pick({
  userId: true,
  title: true,
  description: true,
  priority: true,
  timeRequired: true,
  dueDate: true,
  dueTime: true,
  completed: true,
  slackMessageId: true,
  slackChannelId: true,
  googleEventId: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  importance: true,
  urgency: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertWorkingHours = z.infer<typeof insertWorkingHoursSchema>;
export type WorkingHours = typeof workingHours.$inferSelect;

export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;
