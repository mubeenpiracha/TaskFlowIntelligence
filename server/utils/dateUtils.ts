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
  // Simpler, more direct approach for RFC 3339 format with timezone offset
  try {
    console.log(`[DATE UTILS] Formatting date: ${dateStr} for timezone: ${timezone}`);
    
    // Create a date object from the input
    const date = typeof dateStr === "string" ? new Date(dateStr) : new Date(dateStr);
    
    // Get the timezone offset dictionary - mapping IANA timezone to UTC offset
    const timezoneOffsets: Record<string, string> = {
      'UTC': '+00:00',
      'Europe/London': '+00:00',
      'Europe/Paris': '+01:00',
      'Europe/Berlin': '+01:00',
      'Europe/Athens': '+02:00',
      'Europe/Moscow': '+03:00',
      'Asia/Dubai': '+04:00',
      'Asia/Kolkata': '+05:30',
      'Asia/Shanghai': '+08:00',
      'Asia/Tokyo': '+09:00',
      'Australia/Sydney': '+10:00',
      'Pacific/Auckland': '+12:00',
      'America/New_York': '-05:00',
      'America/Chicago': '-06:00',
      'America/Denver': '-07:00',
      'America/Los_Angeles': '-08:00',
      'America/Anchorage': '-09:00',
      'Pacific/Honolulu': '-10:00',
    };
    
    // Get the offset for the specified timezone, default to +00:00 if not found
    const offset = timezoneOffsets[timezone] || '+00:00';
    
    // Format the date in ISO format and replace the Z with the proper offset
    const isoString = date.toISOString();
    const formattedDate = isoString.replace(/\.\d{3}Z$/, offset);
    
    console.log(`[DATE UTILS] Formatted date with offset: ${formattedDate}`);
    return formattedDate;
  } catch (error) {
    console.error('[DATE UTILS] Error formatting date for Google Calendar:', error);
    
    // Fallback to ISO format but still with proper timezone offset instead of Z
    try {
      const date = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
      return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
    } catch (fallbackError) {
      console.error('[DATE UTILS] Fallback formatting also failed:', fallbackError);
      // Ultimate fallback: just return the current time in ISO format with +00:00
      return new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
    }
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
