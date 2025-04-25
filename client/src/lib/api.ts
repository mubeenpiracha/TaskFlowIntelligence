/**
 * API client utilities for making requests to the backend
 * Provides standardized error handling and response parsing
 * Also includes task-related functions for compatibility with existing components
 */
import { apiRequest } from './queryClient';
import { ApiErrorResponse, ErrorCode, getErrorMessage } from './errorTypes';
import { toast } from '@/hooks/use-toast';

/**
 * Fetch data from the API with standardized error handling
 * 
 * @param endpoint API endpoint path (e.g., '/api/tasks')
 * @param options Optional fetch options
 * @returns Promise resolving to the fetched data
 * @throws Error with standardized message if fetch fails
 */
export async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  try {
    const response = await apiRequest(
      options.method || 'GET',
      endpoint,
      options.body ? JSON.parse(options.body as string) : undefined
    );
    
    if (!response.ok) {
      // Parse the error response
      const errorData: ApiErrorResponse = await response.json();
      
      // Handle specific error types
      if (errorData.code === ErrorCode.UNAUTHORIZED) {
        // Redirect to login if unauthorized
        window.location.href = '/login';
        throw new Error('Session expired. Please log in again.');
      }
      
      // For other errors, throw with the server's error message
      throw new Error(errorData.message || 'An unexpected error occurred');
    }
    
    return await response.json() as T;
  } catch (error) {
    // Format the error message
    const message = getErrorMessage(error);
    
    // Log the error for debugging
    console.error(`API Error (${endpoint}):`, error);
    
    // For non-redirecting errors, show a toast notification
    if (!(error instanceof Error && error.message.includes('Please log in again'))) {
      toast({
        title: "Request Failed",
        description: message,
        variant: "destructive"
      });
    }
    
    throw error;
  }
}

/**
 * Submit data to the API with standardized error handling
 * 
 * @param endpoint API endpoint path (e.g., '/api/tasks')
 * @param data Data to submit
 * @param method HTTP method (defaults to POST)
 * @returns Promise resolving to the response data
 * @throws Error with standardized message if submission fails
 */
export async function submitApi<T, R>(
  endpoint: string,
  data: T,
  method: 'POST' | 'PUT' | 'PATCH' = 'POST'
): Promise<R> {
  try {
    const response = await apiRequest(method, endpoint, data);
    
    if (!response.ok) {
      // Parse the error response
      const errorData: ApiErrorResponse = await response.json();
      
      // Handle specific error types
      if (errorData.code === ErrorCode.UNAUTHORIZED) {
        // Redirect to login if unauthorized
        window.location.href = '/login';
        throw new Error('Session expired. Please log in again.');
      }
      
      // For other errors, throw with the server's error message
      throw new Error(errorData.message || 'An unexpected error occurred');
    }
    
    return await response.json() as R;
  } catch (error) {
    // Format the error message
    const message = getErrorMessage(error);
    
    // Log the error for debugging
    console.error(`API Error (${endpoint}):`, error);
    
    // For non-redirecting errors, show a toast notification
    if (!(error instanceof Error && error.message.includes('Please log in again'))) {
      toast({
        title: "Submission Failed",
        description: message,
        variant: "destructive"
      });
    }
    
    throw error;
  }
}

/**
 * Delete a resource via the API with standardized error handling
 * 
 * @param endpoint API endpoint path (e.g., '/api/tasks/123')
 * @returns Promise resolving to void on success
 * @throws Error with standardized message if deletion fails
 */
export async function deleteApi(endpoint: string): Promise<void> {
  try {
    const response = await apiRequest('DELETE', endpoint);
    
    if (!response.ok) {
      // Parse the error response
      const errorData: ApiErrorResponse = await response.json();
      
      // Handle specific error types
      if (errorData.code === ErrorCode.UNAUTHORIZED) {
        // Redirect to login if unauthorized
        window.location.href = '/login';
        throw new Error('Session expired. Please log in again.');
      }
      
      // For other errors, throw with the server's error message
      throw new Error(errorData.message || 'An unexpected error occurred');
    }
    
    // No need to parse response for DELETE operations
    return;
  } catch (error) {
    // Format the error message
    const message = getErrorMessage(error);
    
    // Log the error for debugging
    console.error(`API Error (${endpoint}):`, error);
    
    // For non-redirecting errors, show a toast notification
    if (!(error instanceof Error && error.message.includes('Please log in again'))) {
      toast({
        title: "Deletion Failed",
        description: message,
        variant: "destructive"
      });
    }
    
    throw error;
  }
}

// Task-related functions (retained for compatibility with existing components)

/**
 * Interface for task data
 */
export interface TaskData {
  title: string;
  description?: string;
  status: string;
  priority: number;
  dueDate?: string;
  completed?: boolean;
  estimatedTime?: number;
  slackMessageId?: string;
  slackChannelId?: string;
  googleCalendarEventId?: string;
}

/**
 * Create a new task
 * 
 * @param taskData Task data to create
 * @returns Created task
 */
export async function createTask(taskData: TaskData) {
  return submitApi('/api/tasks', taskData);
}

/**
 * Update an existing task
 * 
 * @param taskId Task ID to update
 * @param taskData Updated task data
 * @returns Updated task
 */
export async function updateTask(taskId: number, taskData: Partial<TaskData>) {
  return submitApi(`/api/tasks/${taskId}`, taskData, 'PATCH');
}

/**
 * Create a task from a Slack message
 * 
 * @param slackMessage Slack message data
 * @returns Created task
 */
export async function createTaskFromSlackMessage(slackMessage: any) {
  return submitApi('/api/tasks/from-slack', slackMessage);
}

/**
 * Mark a task as complete or incomplete
 * 
 * @param taskId Task ID to update
 * @param completed Whether the task is completed
 * @returns Updated task
 */
export async function markTaskComplete(taskId: number, completed: boolean) {
  return submitApi(`/api/tasks/${taskId}/complete`, { completed }, 'PATCH');
}

/**
 * Delete a task
 * 
 * @param taskId Task ID to delete
 * @returns Success status
 */
export async function deleteTask(taskId: number) {
  return deleteApi(`/api/tasks/${taskId}`);
}

// Slack-related interfaces and functions

/**
 * Interface for Slack message data
 */
export interface SlackMessage {
  id: string;
  channelId: string;
  text: string;
  userId: string;
  username?: string;
  timestamp: string;
  permalink?: string;
  taskDetected?: boolean;
  confidence?: number;
  taskDetails?: {
    title?: string;
    dueDate?: string;
    priority?: number;
    description?: string;
  };
}

/**
 * Interface for webhook task detection response
 */
export interface WebhookTaskResponse {
  tasks: SlackMessage[];
  webhookMode: boolean;
  message?: string;
  webhookStatus?: {
    enabled: boolean;
    url?: string;
    lastError?: string;
  };
}

/**
 * Trigger a manual task detection for Slack messages
 * 
 * @param channelId Optional channel ID to limit detection to
 * @param sendDMs Whether to send DMs for detected tasks
 * @returns Detected tasks
 */
export async function detectSlackTasks(channelId?: string, sendDMs: boolean = false): Promise<WebhookTaskResponse | SlackMessage[]> {
  const params = new URLSearchParams();
  if (channelId) params.append('channelId', channelId);
  if (sendDMs) params.append('sendDMs', 'true');
  
  const endpoint = `/api/slack/detect-tasks${params.toString() ? `?${params.toString()}` : ''}`;
  return fetchApi(endpoint);
}

/**
 * Check for new tasks now (immediate scan)
 * 
 * @returns Response with details about the scan
 */
export async function checkTasksNow(): Promise<{
  success: boolean;
  message: string;
  details: {
    tasksDetected: number;
    usersProcessed: number;
    success: boolean;
  };
}> {
  return submitApi('/api/slack/check-now', {});
}

/**
 * Trigger a deep scan of Slack history
 * 
 * @returns Response with details about the scan
 */
export async function forceScanSlack(): Promise<{
  success: boolean;
  message: string;
  result: {
    tasksDetected: number;
    usersProcessed: number;
  };
}> {
  return submitApi('/api/slack/force-scan', {});
}

// User-related operations

/**
 * Update the user's timezone setting
 * 
 * @param timezone IANA timezone string (e.g., 'America/New_York')
 * @returns Updated user object
 */
export async function updateUserTimezone(timezone: string) {
  return submitApi('/api/user/timezone', { timezone }, 'PATCH');
}

/**
 * Disconnect the user's Google Calendar
 * 
 * @returns Updated user object
 */
export async function disconnectGoogleCalendar() {
  return submitApi('/api/auth/google/calendar/disconnect', {}, 'POST');
}

/**
 * Disconnect the user's Slack account
 * 
 * @returns Updated user object
 */
export async function disconnectSlack() {
  return submitApi('/api/auth/slack/disconnect', {}, 'POST');
}

/**
 * Update the user's Slack channel preferences
 * 
 * @param channels Array of channel IDs or JSON string of channels
 * @returns Updated user object
 */
export async function updateSlackChannelPreferences(channels: string[] | string) {
  const channelData = typeof channels === 'string' ? channels : JSON.stringify(channels);
  return submitApi('/api/user/slack-channels', { channels: channelData }, 'PATCH');
}