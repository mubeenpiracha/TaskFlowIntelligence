/**
 * Calendar utilities and helper functions
 * Used by both the calendar service and components
 */
import { format, parseISO, isValid, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { ErrorCode } from './errorTypes';
import { fetchApi } from './api';
import { CalendarEvent, getCalendarEvents } from './calendarService';

/**
 * Formats a date for display in the calendar
 * 
 * @param date Date to format
 * @param formatStr Format string for date-fns
 * @returns Formatted date string
 */
export function formatDate(date: Date, formatStr: string = 'MMM d, yyyy'): string {
  if (!isValid(date)) return 'Invalid Date';
  return format(date, formatStr);
}

/**
 * Formats a date for the Google Calendar API
 * Uses RFC 3339 format with timezone
 * 
 * @param date Date to format 
 * @returns Formatted date string in RFC 3339 format
 */
export function formatDateForCalendarAPI(date: Date): string {
  if (!isValid(date)) throw new Error('Invalid date for calendar API');
  return date.toISOString();
}

/**
 * Formats a date range for display in the calendar header
 * 
 * @param date Current date
 * @param viewType Current view type (day, week, month)
 * @returns Formatted date range string
 */
export function formatDateRangeForDisplay(date: Date, viewType: 'day' | 'week' | 'month'): string {
  if (!isValid(date)) return 'Invalid Date Range';
  
  switch (viewType) {
    case 'day':
      return format(date, 'EEEE, MMMM d, yyyy');
    case 'week': {
      // Find the start and end of the week
      const day = date.getDay();
      const startDate = new Date(date);
      startDate.setDate(date.getDate() - day);
      const endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      
      // If in the same month
      if (startDate.getMonth() === endDate.getMonth()) {
        return `${format(startDate, 'MMM d')} - ${format(endDate, 'd, yyyy')}`;
      }
      
      // If in different months
      return `${format(startDate, 'MMM d')} - ${format(endDate, 'MMM d, yyyy')}`;
    }
    case 'month':
      return format(date, 'MMMM yyyy');
    default:
      return format(date, 'MMMM d, yyyy');
  }
}

/**
 * Parses a date string from the API
 * 
 * @param dateStr Date string from the API
 * @returns Parsed Date object
 */
export function parseAPIDate(dateStr: string): Date {
  if (!dateStr) throw new Error('Invalid date string');
  
  try {
    const date = parseISO(dateStr);
    if (!isValid(date)) throw new Error('Invalid date format');
    return date;
  } catch (error) {
    console.error('Error parsing date:', dateStr, error);
    throw new Error('Failed to parse date from API');
  }
}

/**
 * Calendar-specific error type
 */
export interface CalendarError {
  message: string;
  code?: ErrorCode;
}

/**
 * Checks if an event conflicts with existing events
 * 
 * @param newEvent New event to check
 * @param existingEvents Existing events to check against
 * @returns True if there is a conflict
 */
export function hasEventConflict(
  newEvent: { startDate: Date; endDate: Date; },
  existingEvents: { start: { dateTime: string }; end: { dateTime: string }; }[]
): boolean {
  const newStart = newEvent.startDate.getTime();
  const newEnd = newEvent.endDate.getTime();
  
  return existingEvents.some(event => {
    const existingStart = new Date(event.start.dateTime).getTime();
    const existingEnd = new Date(event.end.dateTime).getTime();
    
    // Check for overlap
    return (
      (newStart >= existingStart && newStart < existingEnd) || // New event starts during existing event
      (newEnd > existingStart && newEnd <= existingEnd) || // New event ends during existing event
      (newStart <= existingStart && newEnd >= existingEnd) // New event completely contains existing event
    );
  });
}

/**
 * Get the color for an event based on its status or type
 * 
 * @param event Event to get color for
 * @returns Color string (hex or CSS color)
 */
export function getEventColor(event: { colorId?: string; status?: string; }): string {
  // Google Calendar color IDs
  const colorMap: Record<string, string> = {
    '1': '#7986CB', // Lavender
    '2': '#33B679', // Sage
    '3': '#8E24AA', // Grape
    '4': '#E67C73', // Flamingo
    '5': '#F6BF26', // Banana
    '6': '#F4511E', // Tangerine
    '7': '#039BE5', // Peacock
    '8': '#616161', // Graphite
    '9': '#3F51B5', // Blueberry
    '10': '#0B8043', // Basil
    '11': '#D50000', // Tomato
  };
  
  // If the event has a color ID, use it
  if (event.colorId && colorMap[event.colorId]) {
    return colorMap[event.colorId];
  }
  
  // Otherwise, use a default based on status
  switch (event.status) {
    case 'confirmed':
      return '#36C5F0'; // Slack blue
    case 'tentative':
      return '#ECB22E'; // Slack yellow
    case 'cancelled':
      return '#E01E5A'; // Slack red
    default:
      return '#2EB67D'; // Slack green
  }
}

/**
 * Get the start and end dates for a calendar view
 * 
 * @param date Center date for the view
 * @param viewType Type of view (day, week, month)
 * @returns Object with start and end dates
 */
export function getDateRangeForView(date: Date, viewType: 'day' | 'week' | 'month'): { start: Date, end: Date } {
  switch (viewType) {
    case 'day':
      return {
        start: startOfDay(date),
        end: endOfDay(date)
      };
    case 'week':
      return {
        start: startOfWeek(date),
        end: endOfWeek(date)
      };
    case 'month':
      return {
        start: startOfMonth(date),
        end: endOfMonth(date)
      };
    default:
      return {
        start: startOfDay(date),
        end: endOfDay(date)
      };
  }
}

/**
 * Wrapper around getCalendarEvents from the calendar service
 * Used to maintain compatibility with existing component usage
 * 
 * @param startDate Start date for fetching events
 * @param endDate End date for fetching events
 * @param setError Optional function to set error state
 * @returns Calendar events for the date range
 */
export async function fetchCalendarEvents(
  startDate: Date,
  endDate: Date,
  setError?: (error: CalendarError | null) => void
): Promise<CalendarEvent[]> {
  return getCalendarEvents(startDate, endDate, setError);
}

/**
 * Format a date for display in different places
 * 
 * @param date Date to format
 * @param type Type of formatting to apply
 * @returns Formatted date string
 */
export function formatDateForDisplay(date: Date, type: 'short' | 'full' | 'time' = 'short'): string {
  if (!isValid(date)) return 'Invalid Date';
  
  switch (type) {
    case 'short':
      return format(date, 'MMM d');
    case 'full':
      return format(date, 'EEEE, MMMM d, yyyy');
    case 'time':
      return format(date, 'h:mm a');
    default:
      return format(date, 'MMM d, yyyy');
  }
}