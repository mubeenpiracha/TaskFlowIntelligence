/**
 * Test service to verify timezone handling
 */
import { User } from '@shared/schema';
import { formatDateForGoogleCalendar, normalizeGoogleCalendarDate } from '../utils/dateUtils';

/**
 * Test timezone handling for a given date string and timezone
 * This function goes through the exact same conversions as our scheduler
 * to make sure timezones are handled correctly
 */
export function testTimezoneHandling(
  dateStr: string, 
  timezone: string = 'UTC'
): {
  inputDate: string;
  timezone: string;
  stage1Result: string;
  stage2Result: string;
  normalizedResult: string;
} {
  console.log(`[TIMEZONE TEST] Testing timezone handling for ${dateStr} with timezone ${timezone}`);
  
  // Stage 1: Initial conversion (this happens in scheduler.ts)
  // When optimal slot is found, it's formatted with timezone
  const stage1Result = formatDateForGoogleCalendar(dateStr, timezone);
  console.log(`[TIMEZONE TEST] Stage 1 (scheduler): ${stage1Result}`);
  
  // Stage 2: Second conversion in calendarService.ts
  // Only applies if date doesn't already have timezone
  let stage2Result = stage1Result;
  if (!stage1Result.includes('+') && !stage1Result.includes('-', 11)) {
    stage2Result = formatDateForGoogleCalendar(stage1Result, timezone);
    console.log(`[TIMEZONE TEST] Stage 2 (calendarService): ${stage2Result}`);
  } else {
    console.log(`[TIMEZONE TEST] Stage 2 skipped, date already has timezone: ${stage1Result}`);
  }
  
  // Stage 3: Final conversion in google.ts
  // Only applies if date doesn't already have timezone
  let finalResult = stage2Result;
  if (!stage2Result.includes('+') && !stage2Result.includes('-', 11)) {
    finalResult = formatDateForGoogleCalendar(new Date(stage2Result), timezone);
    console.log(`[TIMEZONE TEST] Stage 3 (google.ts): ${finalResult}`);
  } else {
    console.log(`[TIMEZONE TEST] Stage 3 skipped, date already has timezone: ${stage2Result}`);
  }
  
  // Normalize the result (this happens when data comes back from Google Calendar)
  const normalizedResult = normalizeGoogleCalendarDate(finalResult, timezone);
  console.log(`[TIMEZONE TEST] Normalized result: ${normalizedResult}`);
  
  return {
    inputDate: dateStr,
    timezone,
    stage1Result,
    stage2Result,
    normalizedResult
  };
}

/**
 * Test timezone handling with a specific user's settings
 */
export function testUserTimezoneHandling(user: User, date?: Date): any {
  const timezone = user.timezone || 'UTC';
  const testDate = date || new Date(); // Use current date/time if none provided
  
  console.log(`[TIMEZONE TEST] Testing user ${user.id} with timezone ${timezone}`);
  
  // Test with a few different time formats
  const results = {
    // Test with UTC ISO string (Z suffix)
    utcIsoString: testTimezoneHandling(testDate.toISOString(), timezone),
    
    // Test with timezone-less format (scheduler might use this format)
    localString: testTimezoneHandling(testDate.toString(), timezone),
    
    // Test with a specific time tomorrow (common scheduling scenario)
    tomorrowAt2pm: testTimezoneHandling(getTomorrowAt(14, 0, 0).toISOString(), timezone)
  };
  
  return results;
}

/**
 * Get tomorrow's date at a specific time
 */
function getTomorrowAt(hours: number, minutes: number, seconds: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hours, minutes, seconds, 0);
  return date;
}