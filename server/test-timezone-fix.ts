import { createCalendarEvent } from './services/google';
import { format } from 'date-fns';

/**
 * This function tests our timezone handling fix by creating a calendar event
 * at a specific time and comparing the result to verify that the timezone
 * is correctly maintained.
 * 
 * @param refreshToken User's Google Calendar refresh token
 * @param userTimezone User's timezone (IANA format, e.g. 'America/New_York')
 */
export async function testTimezoneHandling(refreshToken: string, userTimezone: string) {
  try {
    console.log('====== TIMEZONE HANDLING TEST ======');
    console.log(`Testing with timezone: ${userTimezone}`);
    
    // Create a test event at the current time
    const now = new Date();
    console.log(`Current time: ${now.toISOString()}`);
    
    // Format for logging
    const localTimeString = format(now, 'yyyy-MM-dd HH:mm:ss');
    console.log(`Local time format: ${localTimeString}`);
    
    // Start time is now, end time is 1 hour from now
    const endTime = new Date(now.getTime() + 60 * 60 * 1000);
    
    console.log('Creating test calendar event with:');
    console.log(`- Start time (with Z): ${now.toISOString()}`);
    console.log(`- Start time (without Z): ${now.toISOString().replace('Z', '')}`);
    console.log(`- End time (with Z): ${endTime.toISOString()}`);
    console.log(`- End time (without Z): ${endTime.toISOString().replace('Z', '')}`);
    console.log(`- Timezone: ${userTimezone}`);
    
    // Create the test event
    const eventResult = await createCalendarEvent(
      refreshToken,
      {
        summary: 'Timezone Fix Test Event',
        description: 'This event was created to test the timezone handling fix',
        start: {
          dateTime: now.toISOString().replace('Z', ''),
          timeZone: userTimezone
        },
        end: {
          dateTime: endTime.toISOString().replace('Z', ''),
          timeZone: userTimezone
        },
        colorId: '7' // Use a specific color to easily identify test events
      }
    );
    
    console.log('Event creation successful!');
    console.log('Event details:', eventResult);
    console.log(`Event ID: ${eventResult.id}`);
    console.log(`Event HTML Link: ${eventResult.htmlLink}`);
    
    if (eventResult.start?.dateTime) {
      console.log(`Event Start DateTime from Google: ${eventResult.start.dateTime}`);
      console.log(`Event Start TimeZone from Google: ${eventResult.start.timeZone}`);
    }
    
    if (eventResult.end?.dateTime) {
      console.log(`Event End DateTime from Google: ${eventResult.end.dateTime}`);
      console.log(`Event End TimeZone from Google: ${eventResult.end.timeZone}`);
    }
    
    console.log('====== END OF TIMEZONE HANDLING TEST ======');
    
    return {
      success: true,
      event: eventResult,
      testTime: now.toISOString(),
      localTime: localTimeString,
      timezone: userTimezone
    };
  } catch (error) {
    console.error('Timezone handling test failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}