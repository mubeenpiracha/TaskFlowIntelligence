/**
 * Calendar utility functions for the client
 * Centralizes calendar-related operations and formatting
 */
import { format, addDays, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { apiRequest } from './queryClient';
import { ErrorCode } from './errorTypes';
import { toast } from '@/hooks/use-toast';

/**
 * Standardized calendar error type
 */
export interface CalendarError {
  message: string;
  code?: string;
  details?: string;
}

/**
 * Format a date for display in the UI
 * 
 * @param date The date to format
 * @param formatStr Optional format string (defaults to 'MMM d, yyyy')
 * @returns Formatted date string
 */
export function formatDateForDisplay(date: Date, formatStr: string = 'MMM d, yyyy'): string {
  return format(date, formatStr);
}

/**
 * Format a date for the Google Calendar API
 * Ensures the date is in RFC 3339 format
 * 
 * @param date The date to format
 * @returns RFC 3339 formatted date string
 */
export function formatDateForCalendarAPI(date: Date): string {
  // Google Calendar API expects RFC 3339 format
  return date.toISOString();
}

/**
 * Get the date range (start and end dates) for a given view type
 * 
 * @param date The base date
 * @param viewType The type of calendar view (day, week, month)
 * @returns Start and end dates
 */
export function getDateRangeForView(date: Date, viewType: 'day' | 'week' | 'month'): { start: Date, end: Date } {
  switch (viewType) {
    case 'day':
      // Just the current day
      const dayStart = new Date(date);
      dayStart.setHours(0, 0, 0, 0);
      
      const dayEnd = new Date(date);
      dayEnd.setHours(23, 59, 59, 999);
      
      return { start: dayStart, end: dayEnd };
      
    case 'week':
      // Current week
      const weekStart = startOfWeek(date, { weekStartsOn: 0 }); // 0 = Sunday
      const weekEnd = endOfWeek(date, { weekStartsOn: 0 });
      return { start: weekStart, end: weekEnd };
      
    case 'month':
      // Current month
      const monthStart = startOfMonth(date);
      const monthEnd = endOfMonth(date);
      return { start: monthStart, end: monthEnd };
      
    default:
      // Default to a day view if viewType is not recognized
      const defaultStart = new Date(date);
      defaultStart.setHours(0, 0, 0, 0);
      
      const defaultEnd = new Date(date);
      defaultEnd.setHours(23, 59, 59, 999);
      
      return { start: defaultStart, end: defaultEnd };
  }
}

/**
 * Format a date range for display in the UI header
 * 
 * @param date The current date
 * @param viewType The type of calendar view (day, week, month)
 * @returns Formatted date range string
 */
export function formatDateRangeForDisplay(date: Date, viewType: 'day' | 'week' | 'month'): string {
  const { start, end } = getDateRangeForView(date, viewType);
  
  switch (viewType) {
    case 'day':
      return format(date, 'MMMM d, yyyy');
      
    case 'week':
      return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
      
    case 'month':
      return format(date, 'MMMM yyyy');
      
    default:
      return format(date, 'MMMM d, yyyy');
  }
}

/**
 * Fetch calendar events from the API for a given date range
 * 
 * @param start Start date
 * @param end End date
 * @param setCalendarError Function to set calendar errors
 * @returns Calendar events array or empty array on error
 */
export async function fetchCalendarEvents(
  start: Date,
  end: Date,
  setCalendarError?: (error: CalendarError | null) => void
) {
  try {
    // Reset any previous errors
    if (setCalendarError) setCalendarError(null);
    
    // Format dates for the API
    const startStr = formatDateForCalendarAPI(start);
    const endStr = formatDateForCalendarAPI(end);
    
    console.log(`Fetching calendar events from ${startStr} to ${endStr}`);
    const res = await apiRequest('GET', `/api/calendar/events?start=${startStr}&end=${endStr}`);
    
    if (!res.ok) {
      // Parse the error response
      const errorData = await res.json();
      
      // Handle known error codes
      if (errorData.code === ErrorCode.CALENDAR_AUTH_EXPIRED) {
        if (setCalendarError) {
          setCalendarError({
            message: errorData.message || 'Your Google Calendar connection has expired. Please reconnect.',
            code: errorData.code
          });
        }
        
        toast({
          title: "Calendar Connection Expired",
          description: "Your Google Calendar authorization has expired. Please reconnect in Settings.",
          variant: "destructive"
        });
        
        return [];
      } else if (errorData.code === ErrorCode.CALENDAR_NOT_CONNECTED) {
        if (setCalendarError) {
          setCalendarError({
            message: 'Connect Google Calendar to view your events here.',
            code: errorData.code
          });
        }
        return [];
      } else if (errorData.code === ErrorCode.CALENDAR_REQUEST_ERROR) {
        if (setCalendarError) {
          setCalendarError({
            message: `Calendar request error: ${errorData.error || 'Invalid request format'}`,
            code: errorData.code,
            details: errorData.details
          });
        }
        
        toast({
          title: "Calendar Request Error",
          description: "There was a problem with the format of the calendar request. Our team has been notified.",
          variant: "destructive"
        });
        
        // Log the detailed error for debugging
        console.error("Calendar API request format error:", errorData);
        return [];
      }
      
      // Handle other errors
      throw new Error(errorData.message || 'Failed to fetch calendar events');
    }
    
    return res.json();
  } catch (error) {
    console.error("Error fetching calendar events:", error);
    if (setCalendarError) {
      setCalendarError({
        message: error instanceof Error ? error.message : 'Failed to fetch calendar events'
      });
    }
    return [];
  }
}