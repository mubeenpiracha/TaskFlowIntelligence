import { apiRequest } from "./queryClient";
import { User, Task, WorkingHours } from "@shared/schema";

// Slack channel interface from the backend
export interface SlackChannel {
  id: string;
  name: string;
  is_member: boolean;
  is_private: boolean;
  is_channel: boolean;
  num_members?: number;
}

// Slack message interface from the backend
export interface SlackMessage {
  user: string;
  text: string;
  ts: string;
  user_profile?: {
    image_72?: string;
    display_name?: string;
    real_name?: string;
  };
  channelId?: string;
  channelName?: string;
  channel?: string;
  
  // Optional customization parameters for task creation
  customTitle?: string;
  customDescription?: string;
  customPriority?: 'high' | 'medium' | 'low';
  customTimeRequired?: string;
  customDueDate?: string;
  customDueTime?: string;
}

// Auth API
export const login = async (username: string, password: string) => {
  const res = await apiRequest('POST', '/api/auth/login', { username, password });
  return res.json();
};

export const register = async (username: string, password: string, email: string) => {
  const res = await apiRequest('POST', '/api/register', { username, password, email });
  return res.json();
};

export const logout = async () => {
  await apiRequest('POST', '/api/auth/logout');
};

export const getMe = async (): Promise<User> => {
  const res = await apiRequest('GET', '/api/auth/me');
  return res.json();
};

// Google OAuth API
export const getGoogleCalendarAuthUrl = async (): Promise<{ url: string }> => {
  const res = await apiRequest('GET', '/api/auth/google/calendar/url');
  return res.json();
};

export const getGoogleLoginUrl = async (): Promise<{ url: string }> => {
  const res = await apiRequest('GET', '/api/auth/google/login/url');
  return res.json();
};

export const disconnectGoogleCalendar = async (): Promise<{ message: string, user: User }> => {
  const res = await apiRequest('POST', '/api/auth/google/disconnect');
  return res.json();
};

// Slack API
export const getSlackAuthUrl = async (): Promise<{ url: string }> => {
  const res = await apiRequest('GET', '/api/auth/slack/url');
  return res.json();
};

export const connectSlack = async (slackUserId: string, workspace: string): Promise<User> => {
  const res = await apiRequest('POST', '/api/slack/connect', { slackUserId, workspace });
  return res.json();
};

export const disconnectSlack = async (): Promise<{ message: string, user: User }> => {
  const res = await apiRequest('POST', '/api/auth/slack/disconnect');
  return res.json();
};

export const getSlackChannels = async (): Promise<SlackChannel[]> => {
  try {
    const res = await apiRequest('GET', '/api/slack/channels');
    
    if (!res.ok) {
      const errorData = await res.json();
      if (errorData.code === 'SLACK_AUTH_ERROR') {
        throw new Error('SLACK_AUTH_ERROR: ' + errorData.message);
      }
      throw new Error(`Failed to fetch Slack channels: ${errorData.message || 'Unknown error'}`);
    }
    
    return res.json();
  } catch (error) {
    console.error('Error in getSlackChannels:', error);
    throw error;
  }
};

export const getSlackChannelPreferences = async (): Promise<{channelIds: string[]}> => {
  const res = await apiRequest('GET', '/api/slack/channels/preferences');
  return res.json();
};

export const saveSlackChannelPreferences = async (channelIds: string[]): Promise<{success: boolean, channelIds: string[]}> => {
  const res = await apiRequest('POST', '/api/slack/channels/preferences', { channelIds });
  return res.json();
};

export const detectSlackTasks = async (channelIds?: string[]): Promise<SlackMessage[]> => {
  let url = '/api/slack/detect-tasks';
  
  // Add channel IDs to query params if provided
  if (channelIds && channelIds.length > 0) {
    const params = new URLSearchParams();
    channelIds.forEach(id => params.append('channels', id));
    url += `?${params.toString()}`;
  }
  
  const res = await apiRequest('GET', url);
  return res.json();
};

export const createTaskFromSlackMessage = async (message: SlackMessage): Promise<Task> => {
  const res = await apiRequest('POST', '/api/slack/create-task', { message });
  return res.json();
};

// Working Hours API
export const getWorkingHours = async (): Promise<WorkingHours> => {
  const res = await apiRequest('GET', '/api/working-hours');
  return res.json();
};

export const updateWorkingHours = async (workingHours: Partial<WorkingHours>): Promise<WorkingHours> => {
  const res = await apiRequest('PATCH', '/api/working-hours', workingHours);
  return res.json();
};

// Tasks API
export const getTasks = async (): Promise<Task[]> => {
  const res = await apiRequest('GET', '/api/tasks');
  return res.json();
};

export const getTasksToday = async (): Promise<Task[]> => {
  const res = await apiRequest('GET', '/api/tasks/today');
  return res.json();
};

export const getTasksByDate = async (date: string): Promise<Task[]> => {
  const res = await apiRequest('GET', `/api/tasks/${date}`);
  return res.json();
};

export const createTask = async (task: Omit<Task, 'id' | 'userId' | 'createdAt'>): Promise<Task> => {
  const res = await apiRequest('POST', '/api/tasks', task);
  return res.json();
};

export const updateTask = async (id: number, task: Partial<Task>): Promise<Task> => {
  const res = await apiRequest('PATCH', `/api/tasks/${id}`, task);
  return res.json();
};

export const deleteTask = async (id: number): Promise<void> => {
  await apiRequest('DELETE', `/api/tasks/${id}`);
};

export const completeTask = async (id: number, completed: boolean): Promise<Task> => {
  const res = await apiRequest('POST', `/api/tasks/${id}/complete`, { completed });
  return res.json();
};

// Calendar API
export const getCalendarEvents = async (start: string, end: string) => {
  const res = await apiRequest('GET', `/api/calendar/events?start=${start}&end=${end}`);
  return res.json();
};

// System monitoring API
export interface MonitoringCheckResult {
  success: boolean;
  message: string;
  details: {
    success: boolean;
    tasksDetected: number;
    usersProcessed: number;
    error?: string;
  };
}

export const checkTasksNow = async (): Promise<MonitoringCheckResult> => {
  const res = await apiRequest('POST', '/api/system/slack/check-now');
  return res.json();
};
