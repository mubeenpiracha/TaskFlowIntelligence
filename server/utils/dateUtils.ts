/**
 * Date utility functions for handling timezone conversions and formatting
 * for Google Calendar API and other date-related operations
 */

/**
 * Formats a date for the Google Calendar API with timezone consideration
 * 
 * @param dateStr An ISO date string or Date object
 * @param timezone User's timezone (IANA format, e.g. 'America/New_York')
 * @returns A properly formatted RFC 3339 timestamp for Google Calendar API
 */
export function formatDateForGoogleCalendar(dateStr: string | Date, timezone?: string): string {
  // The Google Calendar API expects RFC 3339 format dates
  // We should keep any timezone information if it's in the original string
  
  // If it's a Date object, convert to ISO string
  const isoString = typeof dateStr === 'string' ? dateStr : dateStr.toISOString();
  
  // For now, just return the ISO string as is - the timezone handling
  // will be done via the timeZone parameter in the API call
  return isoString;
}

/**
 * Get start and end dates for a given view type (day, week, month)
 * 
 * @param date Base date to calculate the range for
 * @param viewType Type of calendar view (day, week, month)
 * @returns Start and end dates for the specified view
 */
export function getDateRangeForView(date: Date, viewType: 'day' | 'week' | 'month'): { start: Date, end: Date } {
  const start = new Date(date);
  const end = new Date(date);
  
  if (viewType === 'day') {
    // For a day view, just use the same date for start and end
    // Set time to beginning of day
    start.setHours(0, 0, 0, 0);
    // Set time to end of day
    end.setHours(23, 59, 59, 999);
  } else if (viewType === 'week') {
    // For a week view, get the start of the week (Sunday) and end of week (Saturday)
    const dayOfWeek = start.getDay(); // 0 is Sunday, 6 is Saturday
    start.setDate(start.getDate() - dayOfWeek); // Go back to Sunday
    start.setHours(0, 0, 0, 0);
    
    end.setDate(end.getDate() + (6 - dayOfWeek)); // Go forward to Saturday
    end.setHours(23, 59, 59, 999);
  } else if (viewType === 'month') {
    // For a month view, get the first and last day of the month
    start.setDate(1); // First day of month
    start.setHours(0, 0, 0, 0);
    
    end.setMonth(end.getMonth() + 1); // Go to next month
    end.setDate(0); // Last day of current month
    end.setHours(23, 59, 59, 999);
  }
  
  return { start, end };
}

/**
 * Validate a timezone string against IANA timezone database names
 * 
 * @param timezone Timezone string to validate
 * @returns The validated timezone or 'UTC' if invalid
 */
export function validateTimezone(timezone: string): string {
  try {
    // Basic validation - check if Intl.DateTimeFormat accepts it
    // This is a simple way to check if a timezone is valid according to IANA database
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return timezone;
  } catch (e) {
    console.warn(`Invalid timezone: ${timezone}, falling back to UTC`);
    return 'UTC';
  }
}