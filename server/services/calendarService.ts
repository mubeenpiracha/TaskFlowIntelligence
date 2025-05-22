/**
 * Consolidated calendar service for all Google Calendar operations
 */
import { calendar_v3 } from 'googleapis';
import { formatDateForGoogleCalendar, validateTimezone } from '../utils/dateUtils';
import { createCalendarClient, listCalendarEvents as googleListEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, CalendarEvent } from './google';
import { User } from '@shared/schema';

/**
 * Get calendar events for a user within a date range
 * 
 * @param user User object with googleRefreshToken
 * @param startDate Start date for the range
 * @param endDate End date for the range
 * @returns List of calendar events
 */
export async function getCalendarEvents(
  user: User,
  startDate: string | Date,
  endDate: string | Date
): Promise<calendar_v3.Schema$Event[]> {
  if (!user.googleRefreshToken || user.googleRefreshToken.trim() === '') {
    throw new Error('Google Calendar not connected');
  }
  
  // Validate and use the user's timezone
  const userTimezone = validateTimezone(user.timezone || 'UTC');
  
  // Format dates properly for the API
  const timeMin = formatDateForGoogleCalendar(startDate, userTimezone);
  const timeMax = formatDateForGoogleCalendar(endDate, userTimezone);
  
  // Log the request parameters for debugging
  console.log(`[CALENDAR_SERVICE] Fetching events from ${timeMin} to ${timeMax} for user ${user.id}`);
  console.log(`[CALENDAR_SERVICE] User timezone: ${userTimezone}`);
  
  // Call the Google Calendar API
  return await googleListEvents(user.googleRefreshToken, timeMin, timeMax, userTimezone);
}

/**
 * Create a new calendar event for a user
 * 
 * @param user User object with googleRefreshToken
 * @param event Calendar event details
 * @returns Created event
 */
export async function createEvent(
  user: User,
  event: CalendarEvent
): Promise<calendar_v3.Schema$Event> {
  if (!user.googleRefreshToken || user.googleRefreshToken.trim() === '') {
    throw new Error('Google Calendar not connected');
  }
  
  // Validate and use the user's timezone
  const userTimezone = validateTimezone(user.timezone || 'UTC');
  
  // Set the timezone in the event if not already set
  if (event.start && !event.start.timeZone) {
    event.start.timeZone = userTimezone;
  }
  
  if (event.end && !event.end.timeZone) {
    event.end.timeZone = userTimezone;
  }
  
  // Format the dateTime with timezone offset if present
  if (event.start && event.start.dateTime) {
    // Check if the date string already has a timezone offset
    if (!event.start.dateTime.includes('+') && !event.start.dateTime.includes('-', 11)) {
      // Only apply timezone formatting for dates without timezone info
      event.start.dateTime = formatDateForGoogleCalendar(event.start.dateTime, userTimezone);
      console.log(`[CALENDAR_SERVICE] Formatted start time without timezone: ${event.start.dateTime}`);
    } else {
      console.log(`[CALENDAR_SERVICE] Start time already has timezone, keeping as is: ${event.start.dateTime}`);
    }
  }
  
  if (event.end && event.end.dateTime) {
    // Check if the date string already has a timezone offset
    if (!event.end.dateTime.includes('+') && !event.end.dateTime.includes('-', 11)) {
      // Only apply timezone formatting for dates without timezone info
      event.end.dateTime = formatDateForGoogleCalendar(event.end.dateTime, userTimezone);
      console.log(`[CALENDAR_SERVICE] Formatted end time without timezone: ${event.end.dateTime}`);
    } else {
      console.log(`[CALENDAR_SERVICE] End time already has timezone, keeping as is: ${event.end.dateTime}`);
    }
  }
  
  return await createCalendarEvent(user.googleRefreshToken, event);
}

/**
 * Update an existing calendar event
 * 
 * @param user User object with googleRefreshToken
 * @param eventId ID of the event to update
 * @param event Updated event details
 * @returns Updated event
 */
export async function updateEvent(
  user: User,
  eventId: string,
  event: Partial<CalendarEvent>
): Promise<calendar_v3.Schema$Event> {
  if (!user.googleRefreshToken || user.googleRefreshToken.trim() === '') {
    throw new Error('Google Calendar not connected');
  }
  
  return await updateCalendarEvent(user.googleRefreshToken, eventId, event);
}

/**
 * Delete a calendar event
 * 
 * @param user User object with googleRefreshToken
 * @param eventId ID of the event to delete
 * @returns Success status
 */
export async function deleteEvent(
  user: User,
  eventId: string
): Promise<boolean> {
  if (!user.googleRefreshToken || user.googleRefreshToken.trim() === '') {
    throw new Error('Google Calendar not connected');
  }
  
  return await deleteCalendarEvent(user.googleRefreshToken, eventId);
}