/**
 * Date utility functions for handling timezone conversions and formatting
 * for Google Calendar API and other date-related operations
 */

import { zonedTimeToUtc, utcToZonedTime, format as formatTz } from 'date-fns-tz';

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
  try {
    // Convert input to Date
    const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
    // Convert to the user's timezone
    const zoned = utcToZonedTime(date, timezone);
    // Format as RFC 3339 with offset
    return formatTz(zoned, "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone: timezone });
  } catch (error) {
    console.error('[DATE UTILS] Error formatting date for Google Calendar:', error);
    // Fallback to ISO format with +00:00
    try {
      const date = typeof dateStr === 'string' ? new Date(dateStr) : dateStr;
      return formatTz(date, "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone: 'UTC' });
    } catch (fallbackError) {
      console.error('[DATE UTILS] Fallback formatting also failed:', fallbackError);
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
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (viewType === "week") {
    const dayOfWeek = start.getDay();
    start.setDate(start.getDate() - dayOfWeek);
    start.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + (6 - dayOfWeek));
    end.setHours(23, 59, 59, 999);
  } else if (viewType === "month") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(end.getMonth() + 1);
    end.setDate(0);
    end.setHours(23, 59, 59, 999);
  }
  return { start, end };
}

/**
 * Normalize Google Calendar date string to explicit offset using date-fns-tz
 * @param dateString Date string from Google Calendar API
 * @param timezone User's timezone (IANA format)
 * @returns Properly formatted date string with explicit timezone offset
 */
export function normalizeGoogleCalendarDate(dateString: string, timezone: string = 'UTC'): string {
  if (!dateString) return dateString;
  // If already has offset, return as is
  if (/[+-]\d{2}:\d{2}$/.test(dateString)) return dateString;
  // If ends with Z, convert to user's timezone
  if (dateString.endsWith('Z')) {
    const date = new Date(dateString);
    const zoned = utcToZonedTime(date, timezone);
    return formatTz(zoned, "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone: timezone });
  }
  // If no timezone info, assume user's timezone
  const date = new Date(dateString);
  const zoned = utcToZonedTime(date, timezone);
  return formatTz(zoned, "yyyy-MM-dd'T'HH:mm:ssXXX", { timeZone: timezone });
}

/**
 * Validate a timezone string against IANA timezone database names
 *
 * @param timezone Timezone string to validate
 * @returns The validated timezone or 'UTC' if invalid
 */
export function validateTimezone(timezone: string): string {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return timezone;
  } catch (e) {
    console.warn(`Invalid timezone: ${timezone}, falling back to UTC`);
    return "UTC";
  }
}
