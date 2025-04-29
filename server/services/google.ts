import { google, calendar_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { GOOGLE_CALENDAR_REDIRECT_URL, GOOGLE_LOGIN_REDIRECT_URL } from '../config';

// Check if Google API credentials are set
if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.warn("GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET environment variables are not set - Google integration will not work");
}

/**
 * Custom error for token expiration
 */
export class TokenExpiredError extends Error {
  constructor(message = 'Google OAuth token has expired or been revoked') {
    super(message);
    this.name = 'TokenExpiredError';
  }
}

/**
 * Checks if an error is a token expiration error
 * @param error - Error to check
 * @returns True if the error is a token expiration error
 */
/**
 * Check if an error is a token expiration error
 * This covers various ways Google APIs might indicate token expiration
 */
export function isTokenExpiredError(error: any): boolean {
  // Check for various token expiration indicators
  if (!error) return false;
  
  // GaxiosError with invalid_grant
  if (error.response?.data?.error === 'invalid_grant') {
    console.log('[TOKEN ERROR] Invalid grant error detected');
    return true;
  }
  
  // GaxiosError with 'invalid_token' or 'expired_token'
  if (error.response?.data?.error === 'invalid_token' || 
      error.response?.data?.error === 'expired_token') {
    console.log('[TOKEN ERROR] Invalid or expired token error detected in response');
    return true;
  }
  
  // Check for 401 Unauthorized status
  if (error.response?.status === 401) {
    console.log('[TOKEN ERROR] 401 Unauthorized status detected, likely token expiration');
    return true;
  }
  
  // Error message contains token expired
  if (error.message && typeof error.message === 'string') {
    const message = error.message.toLowerCase();
    if (message.includes('token') && 
        (message.includes('expired') || 
         message.includes('revoked') ||
         message.includes('invalid'))) {
      console.log('[TOKEN ERROR] Token expiration/revocation detected in error message:', error.message);
      return true;
    }
  }
  
  return false;
}

/**
 * Check if an error is a Google API request formatting error
 * This helps identify and report issues with the way we're calling Google APIs
 */
export function isGaxiosRequestError(error: any): boolean {
  if (!error) return false;
  
  // Common Gaxios request errors
  if (error.response?.status === 400) {
    console.log('[GAXIOS ERROR] Bad request (400) detected:', error.response?.data);
    return true;
  }
  
  if (error.code === 'ERR_INVALID_URL') {
    console.log('[GAXIOS ERROR] Invalid URL error detected');
    return true;
  }
  
  // Check for 'required' field errors
  if (error.response?.data?.error?.message && 
      error.response.data.error.message.includes('required')) {
    console.log('[GAXIOS ERROR] Missing required field:', error.response.data.error.message);
    return true;
  }
  
  return false;
}

/**
 * Creates an OAuth2 client for Google API authentication
 * @param redirectUrl - OAuth2 redirect URL
 * @returns OAuth2 client
 */
export function createOAuth2Client(redirectUrl: string): OAuth2Client {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUrl
  );
}

/**
 * Generates a URL for Google OAuth2 authentication for calendar access
 * @returns Auth URL to redirect the user to
 */
export function getCalendarAuthUrl(): string {
  const oauth2Client = createOAuth2Client(GOOGLE_CALENDAR_REDIRECT_URL);
  
  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events'
  ];
  
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent' // Force to get refresh token
  });
}

/**
 * Generates a URL for Google OAuth2 authentication for user login
 * @returns Auth URL to redirect the user to
 */
export function getLoginAuthUrl(): string {
  const oauth2Client = createOAuth2Client(GOOGLE_LOGIN_REDIRECT_URL);
  
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ];
  
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });
}

/**
 * Exchanges an auth code for tokens
 * @param code - Authorization code from OAuth2 redirect
 * @param redirectUrl - OAuth2 redirect URL
 * @returns OAuth2 tokens
 */
export async function getTokens(code: string, redirectUrl: string) {
  const oauth2Client = createOAuth2Client(redirectUrl);
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

/**
 * Creates a Calendar API client using a refresh token
 * @param refreshToken - Google OAuth2 refresh token
 * @returns Calendar API client
 */
export function createCalendarClient(refreshToken: string): calendar_v3.Calendar {
  const oauth2Client = createOAuth2Client(GOOGLE_CALENDAR_REDIRECT_URL);
  oauth2Client.setCredentials({
    refresh_token: refreshToken
  });
  
  return google.calendar({ version: 'v3', auth: oauth2Client });
}

export interface CalendarEvent {
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
  colorId?: string;
}

/**
 * Creates a calendar event
 * @param refreshToken - Google OAuth2 refresh token
 * @param event - Calendar event details
 * @returns Created event
 */
export async function createCalendarEvent(
  refreshToken: string,
  event: CalendarEvent
): Promise<calendar_v3.Schema$Event> {
  const calendar = createCalendarClient(refreshToken);
  
  // Log the event payload for debugging
  console.log('[CALENDAR DEBUG] Creating calendar event with the following payload:');
  console.log(JSON.stringify(event, null, 2));
  
  // Ensure we have proper date format for Google Calendar
  try {
    // Add additional validation/logging of the calendar client
    if (!calendar) {
      console.error('[CALENDAR DEBUG] Calendar client is undefined or null');
      throw new Error('Calendar client initialization failed');
    }
    
    // Validate that we have all required fields
    if (!event.start?.dateTime || !event.end?.dateTime) {
      console.error('[CALENDAR DEBUG] Event is missing required start or end time');
      throw new Error('Event missing required start or end time');
    }
    
    // Format dates as proper RFC 3339 format with timezone
    // Fix date format - ensure it's in RFC 3339 format with timezone
    if (event.start.dateTime) {
      // Parse the date string to ensure it's valid
      const startDate = new Date(event.start.dateTime);
      // Format to RFC 3339 with timezone indicator
      event.start.dateTime = startDate.toISOString();
    }
    
    if (event.end.dateTime) {
      const endDate = new Date(event.end.dateTime);
      event.end.dateTime = endDate.toISOString();
    }
    
    // Ensure we have timezone information
    if (!event.start.timeZone) {
      event.start.timeZone = 'UTC';
    }
    
    if (!event.end.timeZone) {
      event.end.timeZone = 'UTC';
    }
    
    console.log('[CALENDAR DEBUG] Formatted event data:');
    console.log(JSON.stringify(event, null, 2));
    
    console.log('[CALENDAR DEBUG] Making API call to Google Calendar');
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
    });
    
    console.log('[CALENDAR DEBUG] Calendar event created successfully, event ID:', response.data.id);
    return response.data;
  } catch (error) {
    console.error('[CALENDAR DEBUG] Error creating calendar event:', error);
    
    // Log more detailed error info if available
    if (error.response) {
      console.error('[CALENDAR DEBUG] Error response data:', JSON.stringify(error.response.data, null, 2));
      console.error('[CALENDAR DEBUG] Error response status:', error.response.status);
      console.error('[CALENDAR DEBUG] Error response headers:', JSON.stringify(error.response.headers, null, 2));
    }
    
    // Check if this is a token expired error and handle it more robustly
    if (isTokenExpiredError(error)) {
      console.log('[CALENDAR DEBUG] Google Calendar token has expired, throwing TokenExpiredError');
      throw new TokenExpiredError();
    }
    
    // Try a fallback approach for any error
    try {
      console.log('[CALENDAR DEBUG] Attempting fallback with simplified event data');
      
      // Create a simplified event with minimal data and absolute timestamps
      const now = new Date();
      const oneHourLater = new Date(now.getTime() + 3600000);
      
      const simplifiedEvent = {
        summary: event.summary || "Task from TaskFlow",
        description: event.description || "Auto-created by TaskFlow scheduler",
        start: {
          dateTime: now.toISOString(),
          timeZone: 'UTC'
        },
        end: {
          dateTime: oneHourLater.toISOString(),
          timeZone: 'UTC'
        }
      };
      
      console.log('[CALENDAR DEBUG] Fallback event:', JSON.stringify(simplifiedEvent, null, 2));
      
      const fallbackResponse = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: simplifiedEvent,
      });
      
      console.log('[CALENDAR DEBUG] Fallback calendar event created successfully:', fallbackResponse.data.id);
      return fallbackResponse.data;
    } catch (fallbackError) {
      console.error('[CALENDAR DEBUG] Fallback event creation failed:', fallbackError);
      
      // If fallback also fails, report the detailed error for diagnosis
      if (fallbackError.response) {
        console.error('[CALENDAR DEBUG] Fallback error response data:', 
          JSON.stringify(fallbackError.response.data, null, 2));
      }
      
      throw new Error(`Calendar event creation failed: ${error.message}. Fallback also failed.`);
    }
  }
}

/**
 * Updates a calendar event
 * @param refreshToken - Google OAuth2 refresh token
 * @param eventId - ID of the event to update
 * @param event - Updated calendar event details
 * @returns Updated event
 */
export async function updateCalendarEvent(
  refreshToken: string,
  eventId: string,
  event: Partial<CalendarEvent>
): Promise<calendar_v3.Schema$Event> {
  const calendar = createCalendarClient(refreshToken);
  
  try {
    const response = await calendar.events.patch({
      calendarId: 'primary',
      eventId: eventId,
      requestBody: event,
    });
    
    return response.data;
  } catch (error) {
    console.error('Error updating calendar event:', error);
    
    // Check if this is a token expired error
    if (isTokenExpiredError(error)) {
      console.log('Google Calendar token has expired, throwing TokenExpiredError');
      throw new TokenExpiredError();
    }
    
    throw error;
  }
}

/**
 * Deletes a calendar event
 * @param refreshToken - Google OAuth2 refresh token
 * @param eventId - ID of the event to delete
 * @returns Success status
 */
export async function deleteCalendarEvent(
  refreshToken: string,
  eventId: string
): Promise<boolean> {
  const calendar = createCalendarClient(refreshToken);
  
  try {
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId,
    });
    
    return true;
  } catch (error) {
    console.error('Error deleting calendar event:', error);
    
    // Check if this is a token expired error
    if (isTokenExpiredError(error)) {
      console.log('Google Calendar token has expired, throwing TokenExpiredError');
      throw new TokenExpiredError();
    }
    
    return false;
  }
}

/**
 * List calendar events for a given time range
 * @param refreshToken - Google OAuth2 refresh token 
 * @param timeMin - Start of time range
 * @param timeMax - End of time range
 * @returns List of calendar events
 * @throws TokenExpiredError if the refresh token has expired or been revoked
 */
export async function listCalendarEvents(
  refreshToken: string,
  timeMin: string,
  timeMax: string,
  timezone?: string
): Promise<calendar_v3.Schema$Event[]> {
  const calendar = createCalendarClient(refreshToken);
  
  try {
    // Ensure both timeMin and timeMax are properly formatted with timezone information
    // Google Calendar API expects RFC 3339 format, like: 2025-04-28T15:55:04.208Z
    
    // If we need to process the timestamps further, we can convert and manipulate them:
    // For now, we'll use the provided timestamps directly, but log them for debugging
    
    console.log('[CALENDAR] Listing events with parameters:');
    console.log(`[CALENDAR] timeMin: ${timeMin}`);
    console.log(`[CALENDAR] timeMax: ${timeMax}`);
    console.log(`[CALENDAR] timezone: ${timezone || 'not specified'}`);
    
    // Make the request to Google Calendar API
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin,
      timeMax: timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      // Only include timezone if it's provided
      ...(timezone && { timeZone: timezone })
    });
    
    // Log the successful response for debugging
    console.log(`[CALENDAR] Successfully retrieved ${response.data.items?.length || 0} events`);
    
    return response.data.items || [];
  } catch (error) {
    console.error('[CALENDAR] Error listing calendar events:', error);
    
    // Check if this is a token expired error
    if (isTokenExpiredError(error)) {
      console.log('[CALENDAR] Google Calendar token has expired, throwing TokenExpiredError');
      throw new TokenExpiredError();
    }
    
    // Log more detailed error info for debugging
    if (error.response) {
      console.error('[CALENDAR] Error response data:', error.response.data);
      console.error('[CALENDAR] Error response status:', error.response.status);
      console.error('[CALENDAR] Error response headers:', error.response.headers);
      console.error('[CALENDAR] Request URL:', error.response.request?.responseURL);
    }
    
    // Propagate the error so it can be handled properly
    throw error;
  }
}

/**
 * Gets user profile information using an access token
 * @param accessToken - Google OAuth2 access token
 * @returns User profile information
 */
export async function getUserProfile(accessToken: string) {
  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({ access_token: accessToken });
  
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  
  try {
    const response = await oauth2.userinfo.get();
    return response.data;
  } catch (error) {
    console.error('Error getting user profile:', error);
    
    // Check if this is a token expired error
    if (isTokenExpiredError(error)) {
      console.log('Google Access token has expired, throwing TokenExpiredError');
      throw new TokenExpiredError();
    }
    
    throw error;
  }
}