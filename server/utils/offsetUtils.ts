/**
 * Simple timezone offset utilities
 * Uses user's stored timezone offset (like "+04:00", "-05:00") instead of IANA timezone strings
 */

/**
 * Format a date with the user's timezone offset
 * @param date - Date object to format
 * @param timezoneOffset - User's timezone offset like "+04:00", "-05:00"
 * @returns ISO string with the user's timezone offset
 */
export function formatDateWithOffset(
  date: Date,
  timezoneOffset: string, // e.g. "+04:00" or "-05:30"
): string {
  // 1️⃣ Parse the offset into total minutes
  const sign = timezoneOffset.startsWith("-") ? -1 : 1;
  const [offH, offM] = timezoneOffset.slice(1).split(":").map(Number);
  const offsetMinutes = sign * (offH * 60 + offM);

  // 2️⃣ Shift the original UTC timestamp by those minutes
  const shiftedTs = date.getTime() + offsetMinutes * 60_000;
  const shiftedDate = new Date(shiftedTs);

  // 3️⃣ Grab the ISO string (which is always UTC) and drop the trailing "Z"
  const isoCore = shiftedDate.toISOString().slice(0, -1);

  // 4️⃣ Append the user’s offset so you get "YYYY-MM-DDTHH:mm:ss.sss±HH:MM"
  return `${isoCore}${timezoneOffset}`;
}
/**
 * Create a date in the user's timezone using their offset
 * @param dateStr - ISO date string
 * @param timezoneOffset - User's timezone offset like "+04:00", "-05:00"
 * @returns Date object adjusted for the user's timezone
 */
export function createDateWithOffset(
  dateStr: string,
  timezoneOffset: string,
): Date {
  // If the date string already has timezone info, use it as is
  if (
    dateStr.includes("+") ||
    (dateStr.includes("-") && dateStr.lastIndexOf("-") > 10)
  ) {
    return new Date(dateStr);
  }

  // If it ends with Z, replace with the user's offset
  if (dateStr.endsWith("Z")) {
    return new Date(dateStr.replace("Z", timezoneOffset));
  }

  // Otherwise assume it's in the user's timezone and add the offset
  return new Date(dateStr + timezoneOffset);
}

/**
 * Get the current time in the user's timezone
 * @param timezoneOffset - User's timezone offset like "+04:00", "-05:00"
 * @returns Date object representing current time in user's timezone
 */
export function getCurrentTimeWithOffset(timezoneOffset: string): Date {
  const now = new Date();

  // Parse the offset to get hours and minutes
  const offsetMatch = timezoneOffset.match(/([+-])(\d{2}):(\d{2})/);
  if (!offsetMatch) return now; // Fallback to UTC if offset is invalid

  const sign = offsetMatch[1] === "+" ? 1 : -1;
  const offsetHours = parseInt(offsetMatch[2], 10);
  const offsetMinutes = parseInt(offsetMatch[3], 10);

  // Calculate total offset in milliseconds
  const offsetMs = sign * (offsetHours * 60 + offsetMinutes) * 60 * 1000;

  // Return a new date adjusted for the user's timezone
  return new Date(now.getTime() + offsetMs);
}

/**
 * Convert a date to the user's timezone using their offset
 * @param date - Date to convert
 * @param timezoneOffset - User's timezone offset like "+04:00", "-05:00"
 * @returns Date object in the user's timezone
 */
export function convertToUserTimezone(
  date: Date,
  timezoneOffset: string,
): Date {
  // Parse the offset to get hours and minutes
  const offsetMatch = timezoneOffset.match(/([+-])(\d{2}):(\d{2})/);
  if (!offsetMatch) return date; // Fallback to original date if offset is invalid

  const sign = offsetMatch[1] === "+" ? 1 : -1;
  const offsetHours = parseInt(offsetMatch[2], 10);
  const offsetMinutes = parseInt(offsetMatch[3], 10);

  // Calculate total offset in milliseconds
  const offsetMs = sign * (offsetHours * 60 + offsetMinutes) * 60 * 1000;

  // Return a new date adjusted for the user's timezone
  return new Date(date.getTime() + offsetMs);
}
