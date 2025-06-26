import { 
  users, type User, type InsertUser, 
  workingHours, type WorkingHours, type InsertWorkingHours,
  tasks, type Task, type InsertTask,
  workspaces, type Workspace, type InsertWorkspace,
  processedMessages, type ProcessedMessage, type InsertProcessedMessage
} from "@shared/schema";

// Re-export the types for external use
export type { User, InsertUser, WorkingHours, InsertWorkingHours, Task, InsertTask, Workspace, InsertWorkspace, ProcessedMessage, InsertProcessedMessage };

export interface IStorage {
  // Workspace operations
  getWorkspace(id: number): Promise<Workspace | undefined>;
  getWorkspaceBySlackId(slackWorkspaceId: string): Promise<Workspace | undefined>;
  getAllWorkspaces(): Promise<Workspace[]>;
  createWorkspace(workspace: InsertWorkspace): Promise<Workspace>;
  updateWorkspace(id: number, workspace: Partial<InsertWorkspace>): Promise<Workspace | undefined>;
  
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserBySlackUserId(slackUserId: string): Promise<User | undefined>;
  getAllUsers(): Promise<User[]>;
  getUsersByWorkspace(workspaceId: number): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, userData: Partial<InsertUser>): Promise<User | undefined>;
  updateUserGoogleToken(id: number, token: string): Promise<User | undefined>;
  disconnectUserGoogleCalendar(id: number): Promise<User | undefined>;
  updateUserSlackInfo(id: number, slackUserId: string, workspace: string, accessToken: string | null): Promise<User | undefined>;
  disconnectUserSlack(id: number): Promise<User | undefined>;
  updateUserSlackChannelPreferences(id: number, channelPreferences: string): Promise<User | undefined>;
  updateUserTimezone(id: number, timezone: string): Promise<User | undefined>;

  // Working hours operations
  getWorkingHours(userId: number): Promise<WorkingHours | undefined>;
  createWorkingHours(workingHours: InsertWorkingHours): Promise<WorkingHours>;
  updateWorkingHours(id: number, workingHours: Partial<InsertWorkingHours>): Promise<WorkingHours | undefined>;

  // Task operations
  getTask(id: number): Promise<Task | undefined>;
  getTasksByUser(userId: number): Promise<Task[]>;
  getTasksByWorkspace(workspaceId: number): Promise<Task[]>;
  getTasksByDate(userId: number, date: string): Promise<Task[]>;
  getTasksBySlackMessageId(messageId: string): Promise<Task | undefined>;
  getTasksByStatus(userId: number, status: string): Promise<Task[]>; 
  createTask(task: InsertTask): Promise<Task>;
  updateTask(id: number, task: Partial<InsertTask>): Promise<Task | undefined>;
  updateTaskStatus(id: number, status: string): Promise<Task | undefined>;
  deleteTask(id: number): Promise<boolean>;
  markTaskComplete(id: number, completed: boolean): Promise<Task | undefined>;
  createPendingTask(userId: number, workspaceId: number, slackMessageId: string, slackChannelId: string, title: string): Promise<Task>;
  
  // Task display operations
  getUndisplayedTasks(userId: number): Promise<Task[]>;
  markTaskDisplayed(id: number, displayed: boolean): Promise<Task | undefined>;
  resetAllTaskDisplayStatus(userId: number): Promise<number>;
  
  // Processed messages operations
  isMessageProcessed(slackMessageId: string, slackChannelId: string): Promise<boolean>;
  markMessageProcessed(message: InsertProcessedMessage): Promise<ProcessedMessage>;
  cleanupOldProcessedMessages(olderThanDays: number): Promise<number>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private workingHours: Map<number, WorkingHours>;
  private tasks: Map<number, Task>;
  private workspaces: Map<number, Workspace>;
  private processedMessages: Map<string, ProcessedMessage>;
  private currentUserId: number;
  private currentWorkingHoursId: number;
  private currentTaskId: number;
  private currentWorkspaceId: number;
  private currentProcessedMessageId: number;

  constructor() {
    this.users = new Map();
    this.workingHours = new Map();
    this.tasks = new Map();
    this.workspaces = new Map();
    this.processedMessages = new Map();
    this.currentUserId = 1;
    this.currentWorkingHoursId = 1;
    this.currentTaskId = 1;
    this.currentWorkspaceId = 1;
    this.currentProcessedMessageId = 1;
  }
  
  // Workspace operations
  async getWorkspace(id: number): Promise<Workspace | undefined> {
    return this.workspaces.get(id);
  }
  
  async getWorkspaceBySlackId(slackWorkspaceId: string): Promise<Workspace | undefined> {
    return Array.from(this.workspaces.values()).find(
      (workspace) => workspace.slackWorkspaceId === slackWorkspaceId
    );
  }
  
  async getAllWorkspaces(): Promise<Workspace[]> {
    return Array.from(this.workspaces.values());
  }
  
  async createWorkspace(insertWorkspace: InsertWorkspace): Promise<Workspace> {
    const id = this.currentWorkspaceId++;
    const now = new Date();
    
    const workspace: Workspace = {
      ...insertWorkspace,
      id,
      createdAt: now,
      active: insertWorkspace.active ?? true,
      maxTasksPerUser: insertWorkspace.maxTasksPerUser ?? 100,
      allowAnonymousTaskCreation: insertWorkspace.allowAnonymousTaskCreation ?? true
    };
    
    this.workspaces.set(id, workspace);
    return workspace;
  }
  
  async updateWorkspace(id: number, workspaceUpdate: Partial<InsertWorkspace>): Promise<Workspace | undefined> {
    const workspace = this.workspaces.get(id);
    if (!workspace) return undefined;
    
    const updatedWorkspace = { ...workspace, ...workspaceUpdate };
    this.workspaces.set(id, updatedWorkspace);
    return updatedWorkspace;
  }
  
  async getUsersByWorkspace(workspaceId: number): Promise<User[]> {
    return Array.from(this.users.values()).filter(
      (user) => user.workspaceId === workspaceId
    );
  }
  
  async getTasksByWorkspace(workspaceId: number): Promise<Task[]> {
    return Array.from(this.tasks.values()).filter(
      (task) => task.workspaceId === workspaceId
    );
  }

  // User operations
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }
  
  async getUserBySlackUserId(slackUserId: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.slackUserId === slackUserId,
    );
  }
  
  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    // Ensure nullable fields are set to null if undefined
    const user: User = { 
      ...insertUser, 
      id,
      slackUserId: insertUser.slackUserId ?? null,
      slackAccessToken: insertUser.slackAccessToken ?? null,
      googleRefreshToken: insertUser.googleRefreshToken ?? null,
      workspaceId: insertUser.workspaceId ?? null,
      slackWorkspace: insertUser.slackWorkspace ?? null,
      slackChannelPreferences: insertUser.slackChannelPreferences ?? null,
      timezone: insertUser.timezone || "UTC",
      timezoneOffset: "+00:00"
    };
    this.users.set(id, user);
    return user;
  }
  
  async updateUser(id: number, userData: Partial<InsertUser>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser = { ...user, ...userData };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  async updateUserGoogleToken(id: number, token: string): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser = { ...user, googleRefreshToken: token };
    this.users.set(id, updatedUser);
    return updatedUser;
  }
  
  async disconnectUserGoogleCalendar(id: number): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser = { ...user, googleRefreshToken: null };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  async updateUserSlackInfo(id: number, slackUserId: string, workspace: string, accessToken: string | null): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser = { 
      ...user, 
      slackUserId, 
      slackWorkspace: workspace,
      slackAccessToken: accessToken
    };
    this.users.set(id, updatedUser);
    return updatedUser;
  }
  
  async disconnectUserSlack(id: number): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser = { 
      ...user, 
      slackUserId: null, 
      slackWorkspace: null,
      slackAccessToken: null,
      slackChannelPreferences: null
    };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  async updateUserSlackChannelPreferences(id: number, channelPreferences: string): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser = { ...user, slackChannelPreferences: channelPreferences };
    this.users.set(id, updatedUser);
    return updatedUser;
  }
  
  async updateUserTimezone(id: number, timezone: string): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    
    const updatedUser = { ...user, timezone };
    this.users.set(id, updatedUser);
    return updatedUser;
  }

  // Working hours operations
  async getWorkingHours(userId: number): Promise<WorkingHours | undefined> {
    return Array.from(this.workingHours.values()).find(
      (wh) => wh.userId === userId,
    );
  }

  async createWorkingHours(insertWorkingHours: InsertWorkingHours): Promise<WorkingHours> {
    const id = this.currentWorkingHoursId++;
    // Ensure nullable fields are set properly
    const workingHoursRecord: WorkingHours = { 
      ...insertWorkingHours, 
      id,
      monday: insertWorkingHours.monday ?? true,
      tuesday: insertWorkingHours.tuesday ?? true,
      wednesday: insertWorkingHours.wednesday ?? true,
      thursday: insertWorkingHours.thursday ?? true,
      friday: insertWorkingHours.friday ?? true,
      saturday: insertWorkingHours.saturday ?? false,
      sunday: insertWorkingHours.sunday ?? false,
      startTime: insertWorkingHours.startTime ?? '09:00',
      endTime: insertWorkingHours.endTime ?? '17:00',
      breakStartTime: insertWorkingHours.breakStartTime ?? null,
      breakEndTime: insertWorkingHours.breakEndTime ?? null,
      focusTimeEnabled: insertWorkingHours.focusTimeEnabled ?? null,
      focusTimeDuration: insertWorkingHours.focusTimeDuration ?? null,
      focusTimePreference: insertWorkingHours.focusTimePreference ?? null
    };
    this.workingHours.set(id, workingHoursRecord);
    return workingHoursRecord;
  }

  async updateWorkingHours(id: number, workingHoursUpdate: Partial<InsertWorkingHours>): Promise<WorkingHours | undefined> {
    const workingHoursRecord = this.workingHours.get(id);
    if (!workingHoursRecord) return undefined;
    
    const updatedWorkingHours = { ...workingHoursRecord, ...workingHoursUpdate };
    this.workingHours.set(id, updatedWorkingHours);
    return updatedWorkingHours;
  }

  // Task operations
  async getTask(id: number): Promise<Task | undefined> {
    return this.tasks.get(id);
  }

  async getTasksByUser(userId: number): Promise<Task[]> {
    return Array.from(this.tasks.values()).filter(
      (task) => task.userId === userId,
    );
  }

  async getTasksByDate(userId: number, date: string): Promise<Task[]> {
    return Array.from(this.tasks.values()).filter(
      (task) => task.userId === userId && task.dueDate === date,
    );
  }

  async getTasksBySlackMessageId(messageId: string): Promise<Task | undefined> {
    return Array.from(this.tasks.values()).find(
      (task) => task.slackMessageId === messageId,
    );
  }

  async getTasksByStatus(userId: number, status: string): Promise<Task[]> {
    return Array.from(this.tasks.values()).filter(
      (task) => task.userId === userId && task.status === status,
    );
  }

  async createTask(insertTask: InsertTask): Promise<Task> {
    const id = this.currentTaskId++;
    const now = new Date();
    // Ensure nullable fields are set properly
    const task: Task = { 
      ...insertTask, 
      id, 
      createdAt: now,
      workspaceId: insertTask.workspaceId ?? null,
      description: insertTask.description ?? null,
      priority: insertTask.priority ?? 'medium',
      timeRequired: insertTask.timeRequired ?? '01:00',
      dueDate: insertTask.dueDate ?? null,
      dueTime: insertTask.dueTime ?? null,
      completed: insertTask.completed ?? false,
      slackMessageId: insertTask.slackMessageId ?? null,
      slackChannelId: insertTask.slackChannelId ?? null,
      slackThreadTs: insertTask.slackThreadTs ?? null,
      slackInteractionMessageTs: insertTask.slackInteractionMessageTs ?? null,
      googleEventId: insertTask.googleEventId ?? null,
      status: insertTask.status ?? 'pending',
      displayed: insertTask.displayed ?? false,
      scheduledStart: insertTask.scheduledStart ?? null,
      scheduledEnd: insertTask.scheduledEnd ?? null,
      importance: insertTask.importance ?? null,
      urgency: insertTask.urgency ?? null,
      recurringPattern: insertTask.recurringPattern ?? null
    };
    this.tasks.set(id, task);
    return task;
  }
  
  async updateTaskStatus(id: number, status: string): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    
    const updatedTask = { ...task, status };
    this.tasks.set(id, updatedTask);
    return updatedTask;
  }
  
  async createPendingTask(userId: number, workspaceId: number, slackMessageId: string, slackChannelId: string, title: string): Promise<Task> {
    const id = this.currentTaskId++;
    const now = new Date();
    
    // Create a minimal task with just enough info to track the message
    const task: Task = {
      id,
      userId,
      workspaceId,
      title,
      description: null,
      priority: 'medium',
      timeRequired: '01:00',
      dueDate: null,
      dueTime: null,
      completed: false,
      slackMessageId,
      slackChannelId,
      slackThreadTs: null,
      slackInteractionMessageTs: null,
      googleEventId: null,
      status: 'pending',
      createdAt: now,
      displayed: false,
      scheduledStart: null,
      scheduledEnd: null,
      importance: null,
      urgency: null,
      recurringPattern: null
    };
    
    this.tasks.set(id, task);
    return task;
  }

  async updateTask(id: number, taskUpdate: Partial<InsertTask>): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    
    const updatedTask = { ...task, ...taskUpdate };
    this.tasks.set(id, updatedTask);
    return updatedTask;
  }

  async deleteTask(id: number): Promise<boolean> {
    return this.tasks.delete(id);
  }

  async markTaskComplete(id: number, completed: boolean): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    
    const updatedTask = { ...task, completed };
    this.tasks.set(id, updatedTask);
    return updatedTask;
  }

  // Task display operations
  async getUndisplayedTasks(userId: number): Promise<Task[]> {
    return Array.from(this.tasks.values()).filter(
      (task) => task.userId === userId && task.displayed === false
    );
  }

  async markTaskDisplayed(id: number, displayed: boolean): Promise<Task | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    
    const updatedTask = { ...task, displayed };
    this.tasks.set(id, updatedTask);
    return updatedTask;
  }

  async resetAllTaskDisplayStatus(userId: number): Promise<number> {
    let count = 0;
    const entries = Array.from(this.tasks.entries());
    for (const [id, task] of entries) {
      if (task.userId === userId && task.displayed === true) {
        this.tasks.set(id, { ...task, displayed: false });
        count++;
      }
    }
    return count;
  }

  // Processed messages operations
  async isMessageProcessed(slackMessageId: string, slackChannelId: string): Promise<boolean> {
    const key = `${slackMessageId}-${slackChannelId}`;
    return this.processedMessages.has(key);
  }

  async markMessageProcessed(message: InsertProcessedMessage): Promise<ProcessedMessage> {
    const processedMessage: ProcessedMessage = {
      id: this.currentProcessedMessageId++,
      workspaceId: message.workspaceId,
      slackMessageId: message.slackMessageId,
      slackChannelId: message.slackChannelId,
      userId: message.userId ?? null,
      processingResult: message.processingResult ?? null,
      processedAt: new Date()
    };
    
    const key = `${message.slackMessageId}-${message.slackChannelId}`;
    this.processedMessages.set(key, processedMessage);
    return processedMessage;
  }

  async cleanupOldProcessedMessages(olderThanDays: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
    
    let count = 0;
    const keysToDelete: string[] = [];
    
    // Collect keys to delete to avoid modifying map during iteration
    this.processedMessages.forEach((message, key) => {
      if (message.processedAt < cutoffDate) {
        keysToDelete.push(key);
      }
    });
    
    // Delete collected keys
    keysToDelete.forEach(key => {
      this.processedMessages.delete(key);
      count++;
    });
    
    return count;
  }
}

import { PgStorage } from './pg-storage';

// Use PostgreSQL storage when DATABASE_URL is set, otherwise fall back to in-memory storage
export const storage = process.env.DATABASE_URL ? new PgStorage() : new MemStorage();
