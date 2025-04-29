CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"workspace_id" integer,
	"title" text NOT NULL,
	"description" text,
	"priority" text DEFAULT 'medium' NOT NULL,
	"time_required" text DEFAULT '01:00' NOT NULL,
	"due_date" text,
	"due_time" text,
	"completed" boolean DEFAULT false NOT NULL,
	"slack_message_id" text,
	"slack_channel_id" text,
	"slack_thread_ts" text,
	"slack_interaction_message_ts" text,
	"google_event_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"scheduled_start" text,
	"scheduled_end" text,
	"importance" integer,
	"urgency" integer,
	"recurring_pattern" text,
	"displayed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"email" text NOT NULL,
	"slack_user_id" text,
	"slack_access_token" text,
	"google_refresh_token" text,
	"workspace_id" integer,
	"slack_workspace" text,
	"slack_channel_preferences" text,
	"timezone" text DEFAULT 'UTC' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working_hours" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"monday" boolean DEFAULT true NOT NULL,
	"tuesday" boolean DEFAULT true NOT NULL,
	"wednesday" boolean DEFAULT true NOT NULL,
	"thursday" boolean DEFAULT true NOT NULL,
	"friday" boolean DEFAULT true NOT NULL,
	"saturday" boolean DEFAULT false NOT NULL,
	"sunday" boolean DEFAULT false NOT NULL,
	"start_time" text DEFAULT '09:00' NOT NULL,
	"end_time" text DEFAULT '17:00' NOT NULL,
	"break_start_time" text DEFAULT '12:00',
	"break_end_time" text DEFAULT '13:00',
	"focus_time_enabled" boolean DEFAULT true,
	"focus_time_duration" text DEFAULT '01:00',
	"focus_time_preference" text DEFAULT 'morning'
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"slack_workspace_id" text NOT NULL,
	"slack_workspace_name" text NOT NULL,
	"slack_bot_token" text NOT NULL,
	"slack_client_id" text NOT NULL,
	"slack_client_secret" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"max_tasks_per_user" integer DEFAULT 100,
	"allow_anonymous_task_creation" boolean DEFAULT true
);
--> statement-breakpoint
CREATE INDEX "task_workspace_id_idx" ON "tasks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "task_user_id_idx" ON "tasks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "slack_message_id_idx" ON "tasks" USING btree ("slack_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "username_idx" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "user_workspace_id_idx" ON "users" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "slack_user_id_idx" ON "users" USING btree ("slack_user_id");--> statement-breakpoint
CREATE INDEX "working_hours_user_id_idx" ON "working_hours" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_id_idx" ON "workspaces" USING btree ("slack_workspace_id");