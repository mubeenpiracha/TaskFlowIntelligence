/**
 * Calendar service for managing Google Calendar interactions
 * Provides a clean interface for calendar operations
 */
import { fetchApi, submitApi, deleteApi } from './api';
import { formatDateForCalendarAPI, CalendarError } from './calendarUtils';
import { ErrorCode } from './errorTypes';
import { toast } from '@/hooks/use-toast';

// Event interface matching the Google Calendar API
export interface CalendarEvent {
  id?: string;
  summary: string;
  description?: string;
  start: {
    dateTime: string;
    timeZone?: string;
  };
  end: {
    dateTime: string;
    timeZone?: string;
  };
  location?: string;
  colorId?: string;
  [key: string]: any;
}

// Lighter interface for frontend event data
export interface EventData {
  id?: string;
  title: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  location?: string;
  colorId?: string;
}

/**
 * Get calendar events for a date range
 * 
 * @param startDate Start date for the range
 * @param endDate End date for the range
 * @param setError Optional function for setting error state
 * @returns Array of calendar events
 */
export async function getCalendarEvents(
  startDate: Date,
  endDate: Date,
  setError?: (error: CalendarError | null) => void
): Promise<CalendarEvent[]> {
  try {
    // Reset any previous errors
    if (setError) setError(null);
    
    // Format dates for the API
    const start = formatDateForCalendarAPI(startDate);
    const end = formatDateForCalendarAPI(endDate);
    
    // Make the API request
    return await fetchApi<CalendarEvent[]>(`/api/calendar/events?start=${start}&end=${end}`);
  } catch (error) {
    // Format error message for display
    const message = error instanceof Error ? error.message : 'Failed to fetch calendar events';
    
    // If we have a setter for errors, use it
    if (setError) {
      setError({
        message,
        code: error instanceof Error && error.message.includes('Google Calendar not connected') 
          ? ErrorCode.CALENDAR_NOT_CONNECTED 
          : error instanceof Error && error.message.includes('authorization expired')
            ? ErrorCode.CALENDAR_AUTH_EXPIRED
            : undefined
      });
    }
    
    return [];
  }
}

/**
 * Create a new calendar event
 * 
 * @param eventData Event data to create
 * @returns Created event object
 */
export async function createCalendarEvent(eventData: EventData): Promise<CalendarEvent> {
  // Convert from frontend format to API format
  const event: CalendarEvent = {
    summary: eventData.title,
    description: eventData.description,
    start: {
      dateTime: formatDateForCalendarAPI(eventData.startDate)
    },
    end: {
      dateTime: formatDateForCalendarAPI(eventData.endDate)
    },
    location: eventData.location,
    colorId: eventData.colorId
  };
  
  try {
    const createdEvent = await submitApi<CalendarEvent, CalendarEvent>(
      '/api/calendar/events',
      event
    );
    
    toast({
      title: "Event Created",
      description: `"${event.summary}" has been added to your calendar.`,
      variant: "default"
    });
    
    return createdEvent;
  } catch (error) {
    // Error handling is done in submitApi
    throw error;
  }
}

/**
 * Update an existing calendar event
 * 
 * @param eventId ID of the event to update
 * @param eventData Updated event data
 * @returns Updated event object
 */
export async function updateCalendarEvent(
  eventId: string,
  eventData: Partial<EventData>
): Promise<CalendarEvent> {
  // Convert from frontend format to API format
  const event: Partial<CalendarEvent> = {};
  
  if (eventData.title) event.summary = eventData.title;
  if (eventData.description !== undefined) event.description = eventData.description;
  if (eventData.location !== undefined) event.location = eventData.location;
  if (eventData.colorId !== undefined) event.colorId = eventData.colorId;
  
  if (eventData.startDate) {
    event.start = {
      dateTime: formatDateForCalendarAPI(eventData.startDate)
    };
  }
  
  if (eventData.endDate) {
    event.end = {
      dateTime: formatDateForCalendarAPI(eventData.endDate)
    };
  }
  
  try {
    const updatedEvent = await submitApi<Partial<CalendarEvent>, CalendarEvent>(
      `/api/calendar/events/${eventId}`,
      event,
      'PATCH'
    );
    
    toast({
      title: "Event Updated",
      description: `"${updatedEvent.summary}" has been updated in your calendar.`,
      variant: "default"
    });
    
    return updatedEvent;
  } catch (error) {
    // Error handling is done in submitApi
    throw error;
  }
}

/**
 * Delete a calendar event
 * 
 * @param eventId ID of the event to delete
 * @returns true if successful
 */
export async function deleteCalendarEvent(eventId: string): Promise<boolean> {
  try {
    await deleteApi(`/api/calendar/events/${eventId}`);
    
    toast({
      title: "Event Deleted",
      description: "The event has been removed from your calendar.",
      variant: "default"
    });
    
    return true;
  } catch (error) {
    // Error handling is done in deleteApi
    return false;
  }
}