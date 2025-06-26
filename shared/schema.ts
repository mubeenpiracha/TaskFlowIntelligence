import { pgTable, text, serial, integer, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Define the main database tables
export const workspaces = pgTable("workspaces", {
  id: serial("id").primaryKey(),
  slackWorkspaceId: text("slack_workspace_id").notNull(),
  slackWorkspaceName: text("slack_workspace_name").notNull(),
  slackBotToken: text("slack_bot_token").notNull(),
  slackClientId: text("slack_client_id").notNull(),
  slackClientSecret: text("slack_client_secret").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  active: boolean("active").notNull().default(true),
  // Settings for the entire workspace
  maxTasksPerUser: integer("max_tasks_per_user").default(100),
  allowAnonymousTaskCreation: boolean("allow_anonymous_task_creation").default(true),
}, (table) => {
  return {
    workspaceIdIdx: uniqueIndex("workspace_id_idx").on(table.slackWorkspaceId),
  };
});

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  password: text("password").notNull(),
  email: text("email").notNull(),
  slackUserId: text("slack_user_id"),
  slackAccessToken: text("slack_access_token"),
  googleRefreshToken: text("google_refresh_token"),
  // Update to reference the workspace id from the workspaces table
  workspaceId: integer("workspace_id"),
  slackWorkspace: text("slack_workspace"),
  slackChannelPreferences: text("slack_channel_preferences"),
  timezone: text("timezone").default("UTC").notNull(),
  timezoneOffset: text("timezone_offset").default("+00:00").notNull(), // Store offset like "+04:00", "-05:00"
}, (table) => {
  return {
    usernameIdx: uniqueIndex("username_idx").on(table.username),
    workspaceIdIdx: index("user_workspace_id_idx").on(table.workspaceId),
    slackUserIdIdx: index("slack_user_id_idx").on(table.slackUserId),
  };
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
}, (table) => {
  return {
    userIdIdx: index("working_hours_user_id_idx").on(table.userId),
  };
});

export const tasks = pgTable("tasks", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  // Add workspace ID for multi-workspace support
  workspaceId: integer("workspace_id"),
  title: text("title").notNull(),
  description: text("description"),
  priority: text("priority").notNull().default("medium"),
  timeRequired: text("time_required").notNull().default("01:00"),
  dueDate: text("due_date"),
  dueTime: text("due_time"),
  completed: boolean("completed").notNull().default(false),
  slackMessageId: text("slack_message_id"),
  slackChannelId: text("slack_channel_id"),
  // Add thread timestamp for better message threaded replies
  slackThreadTs: text("slack_thread_ts"),
  // Store the Slack message timestamp that will be used for updating messages
  slackInteractionMessageTs: text("slack_interaction_message_ts"),
  googleEventId: text("google_event_id"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // New fields for scheduling
  scheduledStart: text("scheduled_start"),
  scheduledEnd: text("scheduled_end"),
  // Fields for task analytics
  importance: integer("importance"),
  urgency: integer("urgency"),
  // Recurring task pattern (daily, weekly, biweekly, monthly, none)
  recurringPattern: text("recurring_pattern"),
  // Track if the task has been displayed to the user in the UI
  displayed: boolean("displayed").notNull().default(false),
}, (table) => {
  return {
    workspaceIdIdx: index("task_workspace_id_idx").on(table.workspaceId),
    userIdIdx: index("task_user_id_idx").on(table.userId),
    slackMessageIdIdx: index("slack_message_id_idx").on(table.slackMessageId),
  };
});

// Add processed messages table to track handled Slack messages and prevent duplicates
export const processedMessages = pgTable("processed_messages", {
  id: serial("id").primaryKey(),
  slackMessageId: text("slack_message_id").notNull(),
  slackChannelId: text("slack_channel_id").notNull(),
  workspaceId: integer("workspace_id").notNull(),
  userId: integer("user_id"),
  processedAt: timestamp("processed_at").notNull().defaultNow(),
  processingResult: text("processing_result"), // "task_created", "no_task_detected", "user_declined", etc.
  // Auto-cleanup: messages older than 30 days can be removed
}, (table) => {
  return {
    messageIdIdx: uniqueIndex("processed_message_id_idx").on(table.slackMessageId, table.slackChannelId),
    workspaceIdIdx: index("processed_message_workspace_id_idx").on(table.workspaceId),
    processedAtIdx: index("processed_message_date_idx").on(table.processedAt),
  };
});

export const insertWorkspaceSchema = createInsertSchema(workspaces).pick({
  slackWorkspaceId: true,
  slackWorkspaceName: true,
  slackBotToken: true,
  slackClientId: true,
  slackClientSecret: true,
  maxTasksPerUser: true,
  allowAnonymousTaskCreation: true,
  active: true,
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
  slackUserId: true,
  slackAccessToken: true,
  googleRefreshToken: true,
  workspaceId: true,
  slackWorkspace: true,
  slackChannelPreferences: true,
  timezone: true,
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
  workspaceId: true,
  title: true,
  description: true,
  priority: true,
  timeRequired: true,
  dueDate: true,
  dueTime: true,
  completed: true,
  slackMessageId: true,
  slackChannelId: true,
  slackThreadTs: true,
  slackInteractionMessageTs: true,
  googleEventId: true,
  status: true,
  scheduledStart: true,
  scheduledEnd: true,
  importance: true,
  urgency: true,
  recurringPattern: true,
  displayed: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export type InsertWorkingHours = z.infer<typeof insertWorkingHoursSchema>;
export type WorkingHours = typeof workingHours.$inferSelect;

export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasks.$inferSelect;



export type InsertWorkspace = z.infer<typeof insertWorkspaceSchema>;
export type Workspace = typeof workspaces.$inferSelect;
