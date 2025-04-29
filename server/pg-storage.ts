import { eq, and } from 'drizzle-orm';
import { db } from './db';
import { 
  users, workingHours, tasks, workspaces,
  type User, type InsertUser, 
  type WorkingHours, type InsertWorkingHours,
  type Task, type InsertTask,
  type Workspace, type InsertWorkspace
} from '@shared/schema';
import type { IStorage } from './storage';
import pkg from 'pg';
const { Pool } = pkg;

// Create a direct pool connection for raw SQL queries
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export class PgStorage implements IStorage {
  // Workspace operations
  async getWorkspace(id: number): Promise<Workspace | undefined> {
    try {
      const result = await db.select().from(workspaces).where(eq(workspaces.id, id));
      return result[0];
    } catch (error) {
      console.error(`[DB] Error getting workspace ${id}:`, error);
      return undefined;
    }
  }
  
  async getWorkspaceBySlackId(slackWorkspaceId: string): Promise<Workspace | undefined> {
    try {
      const result = await db.select().from(workspaces).where(eq(workspaces.slackWorkspaceId, slackWorkspaceId));
      return result[0];
    } catch (error) {
      console.error(`[DB] Error getting workspace by Slack ID ${slackWorkspaceId}:`, error);
      return undefined;
    }
  }
  
  async getAllWorkspaces(): Promise<Workspace[]> {
    try {
      return await db.select().from(workspaces);
    } catch (error) {
      console.error('[DB] Error getting all workspaces:', error);
      return [];
    }
  }
  
  async createWorkspace(workspace: InsertWorkspace): Promise<Workspace> {
    try {
      const result = await db.insert(workspaces).values(workspace).returning();
      return result[0];
    } catch (error) {
      console.error('[DB] Error creating workspace:', error);
      throw error;
    }
  }
  
  async updateWorkspace(id: number, workspaceUpdate: Partial<InsertWorkspace>): Promise<Workspace | undefined> {
    try {
      const result = await db
        .update(workspaces)
        .set(workspaceUpdate)
        .where(eq(workspaces.id, id))
        .returning();
      return result[0];
    } catch (error) {
      console.error(`[DB] Error updating workspace ${id}:`, error);
      return undefined;
    }
  }
  
  async getUsersByWorkspace(workspaceId: number): Promise<User[]> {
    try {
      return await db.select().from(users).where(eq(users.workspaceId, workspaceId));
    } catch (error) {
      console.error(`[DB] Error getting users for workspace ${workspaceId}:`, error);
      return [];
    }
  }
  
  async getTasksByWorkspace(workspaceId: number): Promise<Task[]> {
    try {
      return await db.select().from(tasks).where(eq(tasks.workspaceId, workspaceId));
    } catch (error) {
      console.error(`[DB] Error getting tasks for workspace ${workspaceId}:`, error);
      return [];
    }
  }
  // User operations
  async getUser(id: number): Promise<User | undefined> {
    try {
      // Try with new schema
      const result = await db.select().from(users).where(eq(users.id, id));
      return result[0];
    } catch (error) {
      console.log(`[DB] Fallback to raw query for user ${id} due to schema incompatibility`);
      // Fallback to raw query to handle schema differences
      const query = `SELECT 
        id, username, password, email, 
        slack_user_id as "slackUserId", 
        slack_access_token as "slackAccessToken", 
        google_refresh_token as "googleRefreshToken", 
        slack_workspace as "slackWorkspace", 
        slack_channel_preferences as "slackChannelPreferences", 
        timezone 
      FROM users WHERE id = $1`;
      
      const result = await pool.query(query, [id]);
      
      if (result.rows.length > 0) {
        // Convert raw result to User type with default values for new fields
        const user = result.rows[0];
        return {
          ...user,
          workspaceId: null // Set default value for new field
        } as User;
      }
      return undefined;
    }
  }
  
  async getUserByUsername(username: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.username, username));
    return result[0];
  }
  
  async getUserBySlackUserId(slackUserId: string): Promise<User | undefined> {
    const result = await db.select().from(users).where(eq(users.slackUserId, slackUserId));
    return result[0];
  }
  
  async getAllUsers(): Promise<User[]> {
    try {
      // Try the new schema first (with workspaceId)
      return await db.select().from(users);
    } catch (error) {
      // Fallback to the old schema without workspace ID
      // This is a temporary fix until we run the migration
      const query = `SELECT 
        id, username, password, email, 
        slack_user_id as "slackUserId", 
        slack_access_token as "slackAccessToken", 
        google_refresh_token as "googleRefreshToken", 
        slack_workspace as "slackWorkspace", 
        slack_channel_preferences as "slackChannelPreferences", 
        timezone 
      FROM users`;
      
      const result = await pool.query(query);
      
      // Convert raw results and add workspaceId
      return result.rows.map(row => ({
        ...row,
        workspaceId: null
      })) as User[];
    }
  }
  
  async createUser(user: InsertUser): Promise<User> {
    const result = await db.insert(users).values(user).returning();
    return result[0];
  }
  
  async updateUser(id: number, userData: Partial<InsertUser>): Promise<User | undefined> {
    try {
      const result = await db.update(users)
        .set(userData)
        .where(eq(users.id, id))
        .returning();
      
      return result[0];
    } catch (error) {
      console.error(`[DB] Error updating user ${id}:`, error);
      return undefined;
    }
  }
  
  async updateUserGoogleToken(id: number, token: string): Promise<User | undefined> {
    const result = await db
      .update(users)
      .set({ googleRefreshToken: token })
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }
  
  async disconnectUserGoogleCalendar(id: number): Promise<User | undefined> {
    const result = await db
      .update(users)
      .set({ googleRefreshToken: null })
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }
  
  async updateUserSlackInfo(id: number, slackUserId: string, workspace: string, accessToken: string | null): Promise<User | undefined> {
    const result = await db
      .update(users)
      .set({ slackUserId, slackWorkspace: workspace, slackAccessToken: accessToken })
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }
  
  async disconnectUserSlack(id: number): Promise<User | undefined> {
    const result = await db
      .update(users)
      .set({ 
        slackUserId: null, 
        slackWorkspace: null, 
        slackAccessToken: null,
        slackChannelPreferences: null 
      })
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }
  
  async updateUserSlackChannelPreferences(id: number, channelPreferences: string): Promise<User | undefined> {
    const result = await db
      .update(users)
      .set({ slackChannelPreferences: channelPreferences })
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }
  
  async updateUserTimezone(id: number, timezone: string): Promise<User | undefined> {
    const result = await db
      .update(users)
      .set({ timezone })
      .where(eq(users.id, id))
      .returning();
    return result[0];
  }

  // Working hours operations
  async getWorkingHours(userId: number): Promise<WorkingHours | undefined> {
    const result = await db.select().from(workingHours).where(eq(workingHours.userId, userId));
    return result[0];
  }
  
  async createWorkingHours(workingHoursData: InsertWorkingHours): Promise<WorkingHours> {
    const result = await db.insert(workingHours).values(workingHoursData).returning();
    return result[0];
  }
  
  async updateWorkingHours(id: number, workingHoursUpdate: Partial<InsertWorkingHours>): Promise<WorkingHours | undefined> {
    const result = await db
      .update(workingHours)
      .set(workingHoursUpdate)
      .where(eq(workingHours.id, id))
      .returning();
    return result[0];
  }

  // Task operations
  async getTask(id: number): Promise<Task | undefined> {
    const result = await db.select().from(tasks).where(eq(tasks.id, id));
    return result[0];
  }
  
  async getTasksByUser(userId: number): Promise<Task[]> {
    return db.select().from(tasks).where(eq(tasks.userId, userId));
  }
  
  async getTasksByDate(userId: number, date: string): Promise<Task[]> {
    return db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.dueDate, date)));
  }
  
  async getTasksBySlackMessageId(messageId: string): Promise<Task | undefined> {
    const result = await db
      .select()
      .from(tasks)
      .where(eq(tasks.slackMessageId, messageId));
    return result[0];
  }
  
  async getTasksByStatus(userId: number, status: string): Promise<Task[]> {
    return db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.status, status)));
  }
  
  async createTask(task: InsertTask): Promise<Task> {
    const result = await db.insert(tasks).values(task).returning();
    return result[0];
  }
  
  async updateTaskStatus(id: number, status: string): Promise<Task | undefined> {
    const result = await db
      .update(tasks)
      .set({ status })
      .where(eq(tasks.id, id))
      .returning();
    return result[0];
  }
  
  async createPendingTask(userId: number, workspaceId: number, slackMessageId: string, slackChannelId: string, title: string): Promise<Task> {
    const task: InsertTask = {
      userId,
      workspaceId,
      title,
      slackMessageId,
      slackChannelId,
      status: 'pending',
      description: null,
      priority: 'medium',
      timeRequired: '01:00',
      dueDate: null,
      dueTime: null,
      completed: false,
      googleEventId: null,
      displayed: false,
      scheduledStart: null,
      scheduledEnd: null,
      importance: null,
      urgency: null,
      recurringPattern: null
    };
    
    const result = await db.insert(tasks).values(task).returning();
    return result[0];
  }
  
  async updateTask(id: number, taskUpdate: Partial<InsertTask>): Promise<Task | undefined> {
    const result = await db
      .update(tasks)
      .set(taskUpdate)
      .where(eq(tasks.id, id))
      .returning();
    return result[0];
  }
  
  async deleteTask(id: number): Promise<boolean> {
    const result = await db
      .delete(tasks)
      .where(eq(tasks.id, id))
      .returning({ id: tasks.id });
    return result.length > 0;
  }
  
  async markTaskComplete(id: number, completed: boolean): Promise<Task | undefined> {
    const result = await db
      .update(tasks)
      .set({ completed })
      .where(eq(tasks.id, id))
      .returning();
    return result[0];
  }
  
  // Task display operations
  async getUndisplayedTasks(userId: number): Promise<Task[]> {
    return db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.displayed, false)));
  }

  async markTaskDisplayed(id: number, displayed: boolean): Promise<Task | undefined> {
    const result = await db
      .update(tasks)
      .set({ displayed })
      .where(eq(tasks.id, id))
      .returning();
    return result[0];
  }

  async resetAllTaskDisplayStatus(userId: number): Promise<number> {
    const result = await db
      .update(tasks)
      .set({ displayed: false })
      .where(and(eq(tasks.userId, userId), eq(tasks.displayed, true)))
      .returning();
    return result.length;
  }
}