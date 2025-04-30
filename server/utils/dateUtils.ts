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
export function formatDateForGoogleCalendar(
  dateStr: string | Date,
  timezone: string = 'UTC',
): string {
  // The Google Calendar API expects RFC 3339 format dates with timezone offset
  // Example: 2025-04-30T14:00:00+04:00 for Asia/Dubai timezone
  
  try {
    // Create a date object from the input
    const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
    
    // Get the timezone offset for the specified IANA timezone
    // We need to format the date with the timezone offset directly embedded
    // This is required for proper timeMin/timeMax parameters
    
    // Using toLocaleString with options to get the date in the user's timezone
    // with proper UTC offset
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZoneName: 'short'
    };
    
    // Get the formatted date with timezone info
    const formattedDate = date.toLocaleString('en-US', options);
    
    // Extract the timezone offset from the formatted date
    // Split at the space before the timezone name (e.g., "2025-04-30, 14:00:00 GMT+4")
    const dateParts = formattedDate.split(' ');
    let timezoneOffset = dateParts[dateParts.length - 1];
    
    // Convert timezone name (like GMT+4) to ISO format (+04:00)
    let offset = '';
    if (timezoneOffset.includes('GMT+')) {
      const hours = timezoneOffset.replace('GMT+', '');
      offset = `+${hours.padStart(2, '0')}:00`;
    } else if (timezoneOffset.includes('GMT-')) {
      const hours = timezoneOffset.replace('GMT-', '');
      offset = `-${hours.padStart(2, '0')}:00`;
    } else {
      // Default to +00:00 if we can't parse the offset
      offset = '+00:00';
    }
    
    // Format date in ISO 8601 format with proper timezone offset
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    // Get the time components from the formatted string to ensure they're in the target timezone
    // Format: "04/30/2025, 14:00:00 GMT+4"
    const timeWithDate = dateParts[1]; // Should be like "14:00:00"
    const timeComponents = timeWithDate.replace(',', '').split(':');
    const hours = timeComponents[0].padStart(2, '0');
    const minutes = timeComponents[1].padStart(2, '0');
    const seconds = timeComponents[2].padStart(2, '0');
    
    // Assemble the final ISO string with embedded timezone offset
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offset}`;
  } catch (error) {
    console.error('[DATE UTILS] Error formatting date for Google Calendar:', error);
    
    // Fallback to simpler formatting without timezone if there's an error
    const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
    return date.toISOString().replace('Z', '+00:00');
  }
}

/**
 * Get start and end dates for a given view type (day, week, month)
 *
 * @param date Base date to calculate the range for
 * @param viewType Type of calendar view (day, week, month)
 * @returns Start and end dates for the specified view
 */
export function getDateRangeForView(
  date: Date,
  viewType: "day" | "week" | "month",
): { start: Date; end: Date } {
  const start = new Date(date);
  const end = new Date(date);

  if (viewType === "day") {
    // For a day view, just use the same date for start and end
    // Set time to beginning of day
    start.setHours(0, 0, 0, 0);
    // Set time to end of day
    end.setHours(23, 59, 59, 999);
  } else if (viewType === "week") {
    // For a week view, get the start of the week (Sunday) and end of week (Saturday)
    const dayOfWeek = start.getDay(); // 0 is Sunday, 6 is Saturday
    start.setDate(start.getDate() - dayOfWeek); // Go back to Sunday
    start.setHours(0, 0, 0, 0);

    end.setDate(end.getDate() + (6 - dayOfWeek)); // Go forward to Saturday
    end.setHours(23, 59, 59, 999);
  } else if (viewType === "month") {
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
    return "UTC";
  }
}
