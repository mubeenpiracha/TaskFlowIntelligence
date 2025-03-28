import { google } from 'googleapis';

// Google Calendar API scopes
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

/**
 * Creates an OAuth2 client for Google API authentication
 * @param redirectUrl - OAuth2 redirect URL
 * @returns OAuth2 client
 */
function createOAuth2Client(redirectUrl: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth credentials not set - check environment variables");
  }
  
  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUrl
  );
}

/**
 * Generates a URL for Google OAuth2 authentication
 * @param redirectUrl - OAuth2 redirect URL
 * @returns Auth URL to redirect the user to
 */
function getAuthUrl(redirectUrl: string) {
  const oauth2Client = createOAuth2Client(redirectUrl);
  
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent' // Force to get refresh token every time
  });
}

/**
 * Exchanges an auth code for tokens
 * @param code - Authorization code from OAuth2 redirect
 * @param redirectUrl - OAuth2 redirect URL
 * @returns OAuth2 tokens
 */
async function getTokens(code: string, redirectUrl: string) {
  const oauth2Client = createOAuth2Client(redirectUrl);
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Creates a Calendar API client using a refresh token
 * @param refreshToken - Google OAuth2 refresh token
 * @returns Calendar API client
 */
function createCalendarClient(refreshToken: string) {
  const oauth2Client = createOAuth2Client('');
  oauth2Client.setCredentials({
    refresh_token: refreshToken
  });
  
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

/**
 * Creates a calendar event
 * @param refreshToken - Google OAuth2 refresh token
 * @param event - Calendar event details
 * @returns Created event
 */
async function createCalendarEvent(
  refreshToken: string, 
  event: {
    summary: string;
    description?: string;
    start: { dateTime: string; timeZone: string };
    end: { dateTime: string; timeZone: string };
  }
) {
  const calendar = createCalendarClient(refreshToken);
  
  try {
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event
    });
    
    return response.data;
  } catch (error) {
    console.error('Error creating calendar event:', error);
    throw error;
  }
}

/**
 * Updates a calendar event
 * @param refreshToken - Google OAuth2 refresh token
 * @param eventId - ID of the event to update
 * @param event - Updated calendar event details
 * @returns Updated event
 */
async function updateCalendarEvent(
  refreshToken: string,
  eventId: string,
  event: {
    summary?: string;
    description?: string;
    start?: { dateTime: string; timeZone: string };
    end?: { dateTime: string; timeZone: string };
  }
) {
  const calendar = createCalendarClient(refreshToken);
  
  try {
    const response = await calendar.events.patch({
      calendarId: 'primary',
      eventId: eventId,
      requestBody: event
    });
    
    return response.data;
  } catch (error) {
    console.error('Error updating calendar event:', error);
    throw error;
  }
}

/**
 * Deletes a calendar event
 * @param refreshToken - Google OAuth2 refresh token
 * @param eventId - ID of the event to delete
 * @returns Success status
 */
async function deleteCalendarEvent(refreshToken: string, eventId: string) {
  const calendar = createCalendarClient(refreshToken);
  
  try {
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId
    });
    
    return true;
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    throw error;
  }
}

/**
 * List calendar events for a given time range
 * @param refreshToken - Google OAuth2 refresh token 
 * @param timeMin - Start of time range
 * @param timeMax - End of time range
 * @returns List of calendar events
 */
async function listCalendarEvents(refreshToken: string, timeMin: string, timeMax: string) {
  const calendar = createCalendarClient(refreshToken);
  
  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    return response.data.items;
  } catch (error) {
    console.error('Error listing calendar events:', error);
    throw error;
  }
}

export {
  getAuthUrl,
  getTokens,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents
};
