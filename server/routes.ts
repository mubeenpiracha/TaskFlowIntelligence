import express, { type Express, type Request, type Response, type NextFunction } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import { storage } from "./storage";
import { z } from "zod";
import { insertTaskSchema, insertUserSchema, insertWorkingHoursSchema } from "@shared/schema";
import { randomBytes, pbkdf2, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

import fs from 'fs';
import path from 'path';

// Messages tracking remains file-based for now
// File path for processed messages persistence
const PROCESSED_MESSAGES_FILE = path.join(process.cwd(), 'processed_messages.json');

// Password hashing utilities
const pbkdf2Async = promisify(pbkdf2);
const ITERATIONS = 10000;
const KEYLEN = 64;
const DIGEST = 'sha512';

// Hash a password
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await pbkdf2Async(password, salt, ITERATIONS, KEYLEN, DIGEST);
  return `${derivedKey.toString('hex')}.${salt}.${ITERATIONS}.${KEYLEN}.${DIGEST}`;
}

// Verify a password against a hash
async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  const [key, salt, iterations, keylen, digest] = hashedPassword.split('.');
  
  // If the hash doesn't have all 5 parts, it's an old plaintext password
  if (!key || !salt || !iterations || !keylen || !digest) {
    // Old plaintext password, just compare directly (only for backward compatibility)
    return password === hashedPassword;
  }
  
  const iterCount = parseInt(iterations, 10);
  const keyLength = parseInt(keylen, 10);
  const derivedKey = await pbkdf2Async(password, salt, iterCount, keyLength, digest);
  return key === derivedKey.toString('hex');
}
import { detectTasks, sendMessage, listUserChannels, sendTaskDetectionDM, testDirectMessage, getUserTimezone, getChannelName, formatDateForSlack, type SlackChannel, type SlackMessage } from "./services/slack";
import { analyzeMessageForTask, type TaskAnalysisResponse } from "./services/openaiService";
import axios from "axios";
import { slack } from "./services/slack";
import { WebClient } from "@slack/web-api";
import { 
  getCalendarAuthUrl, 
  getLoginAuthUrl,
  getTokens, 
  getUserProfile,
  createCalendarEvent, 
  updateCalendarEvent, 
  deleteCalendarEvent, 
  listCalendarEvents,
  TokenExpiredError,
  isGaxiosRequestError
} from "./services/google";
import { 
  getSlackAuthUrl,
  exchangeCodeForToken
} from "./services/slackOAuth";

/**
 * Helper function to ensure timezone is in valid IANA format for Google Calendar
 * Google Calendar requires IANA format timezones like 'America/New_York'
 * 
 * Note: We're no longer using this as we rely on Google Calendar's default timezone handling
 */
function validateTimezone(timezone: string): string {
  // Check if the timezone appears to be in IANA format (Continent/City)
  if (/^[A-Za-z]+\/[A-Za-z_]+$/.test(timezone)) {
    return timezone; // Already valid IANA format
  }
  
  // Map common non-IANA formats to IANA
  const timezoneMap: Record<string, string> = {
    'EST': 'America/New_York',
    'EDT': 'America/New_York',
    'CST': 'America/Chicago',
    'CDT': 'America/Chicago',
    'MST': 'America/Denver',
    'MDT': 'America/Denver', 
    'PST': 'America/Los_Angeles',
    'PDT': 'America/Los_Angeles',
    'GMT': 'UTC',
    'UTC': 'UTC'
  };
  
  console.log(`[TIMEZONE DEBUG] Mapping timezone: ${timezone} to IANA format`);
  return timezoneMap[timezone] || 'UTC'; // Return mapped value or default to UTC
}

import { GOOGLE_LOGIN_REDIRECT_URL, GOOGLE_CALENDAR_REDIRECT_URL, SLACK_OAUTH_REDIRECT_URL } from './config';
import { getChannelPreferences, saveChannelPreferences } from './services/channelPreferences';
import { createTaskFromSlackMessage, sendTaskConfirmation } from './services/taskCreation';

import { handleSlackEvent, getWebhookHealthStatus } from './services/slackEvents';
import { 
  startSlackMonitoring, 
  resetMonitoring,
  checkForNewTasksManually,
  getMonitoringStatus,
  clearProcessedMessages
} from './services/slackMonitor';

// Create a store for sessions
import createMemoryStore from 'memorystore';
const MemoryStore = createMemoryStore(session);

export async function registerRoutes(app: Express): Promise<Server> {
  // Slack URL verification handler for root path
  // This must be registered before session middleware to ensure it's processed first
  app.post('/', express.json(), (req, res) => {
    console.log('Received root POST request:', typeof req.body, req.body);
    
    // Check if this is a URL verification request from Slack
    if (req.body && req.body.type === 'url_verification') {
      console.log('Returning Slack challenge:', req.body.challenge);
      // Return the challenge value to verify the URL
      return res.status(200).json({ challenge: req.body.challenge });
    }
    
    // If not a verification request, pass through to other routes
    console.log('Not a Slack verification request');
    res.status(404).send('Not Found');
  });

  // Session middleware
  app.use(session({
    secret: process.env.SESSION_SECRET || 'taskflow-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 86400000 }, // 1 day
    store: new MemoryStore({
      checkPeriod: 86400000 // prune expired entries every 24h
    })
  }));

  // Auth middleware
  const requireAuth = (req: Request, res: Response, next: Function) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    next();
  };

  // Auth routes
  app.post('/api/auth/register', async (req, res) => {
    try {
      // Parse the user data
      let userData = insertUserSchema.parse(req.body);
      const existingUser = await storage.getUserByUsername(userData.username);
      
      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists' });
      }
      
      // Hash the password before storing
      const hashedPassword = await hashPassword(userData.password);
      
      // Create user with hashed password
      const user = await storage.createUser({
        ...userData,
        password: hashedPassword
      });
      
      // Create default working hours for new user
      await storage.createWorkingHours({
        userId: user.id,
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: false,
        sunday: false,
        startTime: '09:00',
        endTime: '17:00',
        breakStartTime: '12:00',
        breakEndTime: '13:00',
        focusTimeEnabled: true,
        focusTimeDuration: '01:00',
        focusTimePreference: 'morning',
      });
      
      // Set user in session
      req.session.userId = user.id;
      
      // Remove password from response
      const { password, ...userWithoutPassword } = user;
      res.status(201).json(userWithoutPassword);
    } catch (error) {
      console.error(error);
      res.status(400).json({ message: 'Invalid user data' });
    }
  });
  
  app.post('/api/auth/login', async (req, res) => {
    try {
      const { username, password } = z.object({
        username: z.string(),
        password: z.string()
      }).parse(req.body);
      
      const user = await storage.getUserByUsername(username);
      
      if (!user) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      
      // Verify password with our secure verification function
      const isPasswordValid = await verifyPassword(password, user.password);
      
      if (!isPasswordValid) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }
      
      // Set user in session
      req.session.userId = user.id;
      
      // Remove password from response
      const { password: _, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error(error);
      res.status(400).json({ message: 'Invalid credentials' });
    }
  });
  
  app.post('/api/auth/logout', (req, res) => {
    req.session.destroy(() => {
      res.status(200).json({ message: 'Logged out successfully' });
    });
  });
  
  app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      
      if (!user) {
        req.session.destroy(() => {});
        return res.status(404).json({ message: 'User not found' });
      }
      
      // Remove password from response
      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server error' });
    }
  });
  
  // Endpoint to update user timezone
  app.post('/api/user/timezone', requireAuth, async (req, res) => {
    try {
      const timezoneSchema = z.object({
        timezone: z.string().min(1)
      });
      
      const parseResult = timezoneSchema.safeParse(req.body);
      
      if (!parseResult.success) {
        return res.status(400).json({ 
          message: 'Invalid timezone format',
          errors: parseResult.error.errors
        });
      }
      
      const { timezone } = parseResult.data;
      
      // Validate that the timezone is a valid IANA timezone identifier
      try {
        // This will throw if the timezone is invalid
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
      } catch (error) {
        return res.status(400).json({ message: 'Invalid timezone identifier' });
      }
      
      // Update user timezone
      const updatedUser = await storage.updateUserTimezone(req.session.userId!, timezone);
      
      if (!updatedUser) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      // Return success with the new timezone
      const { password, ...userWithoutPassword } = updatedUser;
      res.json(userWithoutPassword);
      
      console.log(`[TIMEZONE] User ${req.session.userId} updated timezone to ${timezone}`);
    } catch (error) {
      console.error('[TIMEZONE] Error updating user timezone:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });
  
  // Google OAuth routes
  // 1. Connect calendar for existing user
  app.get('/api/auth/google/calendar/url', requireAuth, (req, res) => {
    try {
      // Use fixed redirect URL from config
      const authUrl = getCalendarAuthUrl();
      res.json({ url: authUrl });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to generate Google auth URL' });
    }
  });
  
  app.get('/api/auth/google/calendar/callback', async (req, res) => {
    if (!req.session.userId) {
      return res.redirect('/#/login?error=not_authenticated');
    }
    
    try {
      const { code } = z.object({
        code: z.string()
      }).parse(req.query);
      
      // Use fixed redirect URL from config
      const tokens = await getTokens(code, GOOGLE_CALENDAR_REDIRECT_URL);
      
      if (!tokens.refresh_token) {
        return res.redirect('/#/settings?error=no_refresh_token');
      }
      
      // Store refresh token in user record
      await storage.updateUserGoogleToken(req.session.userId, tokens.refresh_token);
      
      res.redirect('/#/settings?google_connected=true');
    } catch (error) {
      console.error(error);
      res.redirect('/#/settings?error=google_auth_failed');
    }
  });
  
  // 2. Login/signup with Google
  app.get('/api/auth/google/login/url', (req, res) => {
    try {
      // Use fixed redirect URL from config
      const authUrl = getLoginAuthUrl();
      res.json({ url: authUrl });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to generate Google auth URL' });
    }
  });
  
  app.get('/api/auth/google/login/callback', async (req, res) => {
    try {
      const { code } = z.object({
        code: z.string()
      }).parse(req.query);
      
      // Use fixed redirect URL from config
      const tokens = await getTokens(code, GOOGLE_LOGIN_REDIRECT_URL);
      
      if (!tokens.access_token) {
        return res.redirect('/#/login?error=auth_failed');
      }
      
      // Get user profile
      try {
        const userProfile = await getUserProfile(tokens.access_token);
        
        if (!userProfile.email) {
          return res.redirect('/#/login?error=no_email');
        }
        
        const email = userProfile.email;
        const name = userProfile.name || email.split('@')[0];
        
        // Check if user with this email exists
        let user = await storage.getUserByUsername(email);
        
        // If user doesn't exist, create them
        if (!user) {
          // Generate a random password - user won't need this since they'll log in with Google
          const randomPassword = Math.random().toString(36).slice(-8);
          // Hash the random password for security
          const hashedPassword = await hashPassword(randomPassword);
          
          user = await storage.createUser({
            username: email,
            email,
            password: hashedPassword,
            slackUserId: null,
            slackWorkspace: null,
            googleRefreshToken: tokens.refresh_token || undefined
          });
          
          // Create default working hours for new user
          await storage.createWorkingHours({
            userId: user.id,
            monday: true,
            tuesday: true,
            wednesday: true,
            thursday: true,
            friday: true,
            saturday: false,
            sunday: false,
            startTime: '09:00',
            endTime: '17:00',
            breakStartTime: '12:00',
            breakEndTime: '13:00',
            focusTimeEnabled: true,
            focusTimeDuration: '120',
            focusTimePreference: 'morning'
          });
        } else if (tokens.refresh_token) {
          // Update existing user's Google token if we got a new one
          // or if their existing token is empty or null
          const shouldUpdateToken = (!user.googleRefreshToken || user.googleRefreshToken === '');
          if (shouldUpdateToken || tokens.refresh_token !== user.googleRefreshToken) {
            await storage.updateUserGoogleToken(user.id, tokens.refresh_token);
          }
        }
        
        // Store user ID in session
        req.session.userId = user.id;
        
        // Redirect to dashboard on successful login
        return res.redirect('/#/dashboard');
      } catch (error) {
        console.error('Error in Google login:', error);
        
        // Check if it's a People API error (common if the API hasn't been enabled)
        if (error.message && error.message.includes('People API has not been used')) {
          return res.redirect('/#/login?error=people_api_not_enabled');
        }
        
        return res.redirect('/#/login?error=profile_fetch_failed');
      }
    } catch (error) {
      console.error(error);
      res.redirect('/#/login?error=google_auth_failed');
    }
  });
  
  // Slack OAuth routes
  app.get('/api/auth/slack/url', (req, res) => {
    try {
      const authUrl = getSlackAuthUrl();
      res.json({ url: authUrl });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to generate Slack auth URL' });
    }
  });

  // Slack Events API endpoint for event subscriptions - with enhanced logging
  app.post('/slack/events', express.raw({ type: '*/*' }), async (req, res) => {
    console.log('=== RECEIVED SLACK EVENTS API REQUEST ===');
    console.log('Headers:', JSON.stringify(req.headers));
    
    let body;
    try {
      // If it's a string (raw body), try to parse it as JSON
      if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
        const rawBody = req.body.toString();
        console.log('Raw body (first 500 chars):', rawBody.substring(0, 500));
        
        try {
          body = JSON.parse(rawBody);
          // Attach the parsed body for further processing
          req.body = body;
        } catch (parseError) {
          console.log('Body is not valid JSON, using as-is');
          console.log('Raw body type:', typeof rawBody);
          console.log('Raw body length:', rawBody.length);
          // For URL encoded form data
          if (req.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
            const urlParams = new URLSearchParams(rawBody);
            const formData: Record<string, string> = {};
            urlParams.forEach((value, key) => {
              formData[key] = value;
            });
            body = formData;
            req.body = body;
          }
        }
      } else {
        body = req.body;
        console.log('Body (parsed):', JSON.stringify(body).substring(0, 500));
      }
    } catch (error) {
      console.error('Error handling/parsing request body:', error);
      body = req.body;
    }
    
    // Enhanced debugging for Slack event
    const eventType = body?.type;
    const eventId = body?.event_id;
    const event = body?.event;
    
    console.log(`Event Type: ${eventType}`);
    console.log(`Event ID: ${eventId}`);
    
    if (event) {
      console.log(`Event Subtype: ${event.type}`);
      if (event.type === 'message') {
        console.log(`Message: "${event.text?.substring(0, 100)}..."`);
        console.log(`Channel: ${event.channel}`);
        console.log(`User: ${event.user}`);
        console.log(`Timestamp: ${event.ts}`);
      }
    }
    
    // Handle URL verification directly here for more robust processing
    if (body?.type === 'url_verification') {
      console.log('Handling URL verification directly');
      return res.status(200).json({ challenge: body.challenge });
    }
    
    try {
      // Process the event with our handler
      const result = await handleSlackEvent(body);
      console.log('Event processing result:', JSON.stringify(result));
      
      // Always return 200 OK to Slack to acknowledge receipt
      res.status(200).send('Event received');
    } catch (error) {
      console.error('Error handling Slack event:', error);
      
      // Only send response if not already sent
      if (!res.headersSent) {
        res.status(200).send('Event received');  // Always return 200 to Slack
      }
    }
  });
  
  // Slack verification endpoint (for testing connectivity)
  app.post('/slack/verify', express.urlencoded({ extended: true }), (req, res) => {
    console.log('Received Slack verification request');
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    
    // Simply echo back what was received for debugging
    res.status(200).json({
      received: {
        headers: {
          'content-type': req.headers['content-type']
        },
        body: req.body
      },
      message: 'Verification endpoint reached successfully'
    });
  });
  
  app.get('/api/auth/slack/callback', async (req, res) => {
    try {
      const { code } = z.object({
        code: z.string()
      }).parse(req.query);
      
      if (!req.session.userId) {
        return res.redirect('/#/login?error=not_authenticated');
      }
      
      const { 
        userId, 
        teamId, 
        teamName, 
        botAccessToken, 
        userAccessToken 
      } = await exchangeCodeForToken(code);
      
      // Store the Slack user ID, workspace, and user token in the user record
      // We store the user token (xoxp-) for personalized interactions
      await storage.updateUserSlackInfo(
        req.session.userId, 
        userId, 
        teamName, 
        userAccessToken  // Store the user token from the authed_user object
      );
      
      // Create default empty channel preferences
      await saveChannelPreferences(req.session.userId, []);
      
      // Log success and token types for debugging
      console.log(`Slack connected for user ${req.session.userId}: user token = ${userAccessToken ? 'present' : 'missing'}, bot token = ${botAccessToken ? 'present' : 'missing'}`);
      
      res.redirect('/#/settings?slack_connected=true');
    } catch (error) {
      console.error('Error in Slack OAuth:', error);
      res.redirect('/#/settings?error=slack_auth_failed');
    }
  });
  
  // Disconnect Google Calendar integration
  app.post('/api/auth/google/disconnect', requireAuth, async (req, res) => {
    try {
      const user = await storage.disconnectUserGoogleCalendar(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      const { password, ...userData } = user;
      res.json({ message: 'Google Calendar disconnected successfully', user: userData });
    } catch (error) {
      console.error('Error disconnecting Google Calendar:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });
  
  // Disconnect Slack integration
  app.post('/api/auth/slack/disconnect', requireAuth, async (req, res) => {
    try {
      const user = await storage.disconnectUserSlack(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      const { password, ...userData } = user;
      res.json({ message: 'Slack disconnected successfully', user: userData });
    } catch (error) {
      console.error('Error disconnecting Slack:', error);
      res.status(500).json({ message: 'Server error' });
    }
  });
  
  // Slack integration routes
  app.post('/api/slack/connect', requireAuth, async (req, res) => {
    try {
      const { slackUserId, workspace } = z.object({
        slackUserId: z.string(),
        workspace: z.string()
      }).parse(req.body);
      
      const user = await storage.updateUserSlackInfo(req.session.userId!, slackUserId, workspace, null);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      // Remove password from response
      const { password, ...userWithoutPassword } = user;
      res.json(userWithoutPassword);
    } catch (error) {
      console.error(error);
      res.status(400).json({ message: 'Invalid slack data' });
    }
  });
  
  app.get('/api/slack/channels', requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      
      if (!user || !user.slackUserId) {
        return res.status(400).json({ 
          message: 'Slack integration not configured', 
          code: 'SLACK_NOT_CONNECTED' 
        });
      }
      
      try {
        // Use the user's Slack access token when available
        const channels = await listUserChannels(user.slackAccessToken);
        res.json(channels);
      } catch (error: any) {
        // Handle specific Slack authentication errors
        if (error.message && error.message.startsWith('SLACK_AUTH_ERROR:')) {
          return res.status(401).json({ 
            message: error.message.replace('SLACK_AUTH_ERROR: ', ''), 
            code: 'SLACK_AUTH_ERROR' 
          });
        }
        
        // Handle generic Slack errors
        console.error('Error fetching Slack channels:', error);
        return res.status(500).json({ 
          message: 'Failed to fetch Slack channels. There may be an issue with your Slack token or permissions.', 
          code: 'SLACK_API_ERROR'
        });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server error' });
    }
  });
  
  app.post('/api/slack/channels/preferences', requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      
      if (!user || !user.slackUserId) {
        return res.status(400).json({ message: 'Slack integration not configured' });
      }
      
      // Validate request body
      const { channelIds } = req.body;
      if (!Array.isArray(channelIds)) {
        return res.status(400).json({ message: 'channelIds must be an array' });
      }
      
      // Store channel preferences using service function
      await saveChannelPreferences(req.session.userId!, channelIds);
      
      res.json({ success: true, channelIds });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to save channel preferences' });
    }
  });
  
  app.get('/api/slack/channels/preferences', requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      
      if (!user || !user.slackUserId) {
        return res.status(400).json({ message: 'Slack integration not configured' });
      }
      
      // Get channel IDs using service function
      const channelIds = await getChannelPreferences(req.session.userId!);
      
      res.json({ channelIds });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to get channel preferences' });
    }
  });
  
  app.get('/api/slack/detect-tasks', requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      
      if (!user || !user.slackUserId) {
        return res.status(400).json({ message: 'Slack integration not configured' });
      }
      
      // Get channel IDs from query parameters, or default to stored preferences
      let channelIds: string[] = [];
      
      if (req.query.channels) {
        // Use channels from query params if provided
        channelIds = Array.isArray(req.query.channels) 
          ? req.query.channels as string[] 
          : [req.query.channels as string];
      } else {
        // Otherwise, use the channel preferences service to get the user's preferences
        channelIds = await getChannelPreferences(req.session.userId!);
        
        // If no channels are selected, we'll return a specific error message
        // that will prompt the frontend to direct the user to the channel selection UI
        if (channelIds.length === 0) {
          return res.status(400).json({ 
            message: 'No Slack channels selected for monitoring',
            code: 'NO_CHANNELS_SELECTED'
          });
        }
      }
      
      // WEBHOOK-ONLY MODE: Instead of actively polling for new messages,
      // we'll just return pending tasks that might have been detected via webhooks
      console.log("Running in webhook-only mode - no active message polling");
      
      // Get webhook health status to inform the client
      const webhookStatus = getWebhookHealthStatus();
      console.log("Webhook status:", webhookStatus);
      
      // Check if this is the initial page load or a user-initiated refresh
      const isInitialLoad = req.query.initialLoad === 'true';
      const isManualRefresh = req.query.refresh === 'true';
      
      // If this is a manual refresh or initial load, we reset the display status for all tasks 
      // This ensures users can see all tasks again after a refresh
      if (isManualRefresh || isInitialLoad) {
        const resetCount = await storage.resetAllTaskDisplayStatus(req.session.userId!);
        console.log(`Reset display status for ${resetCount} tasks due to ${isManualRefresh ? 'manual refresh' : 'initial load'}`);
      }
      
      // Get undisplayed and pending tasks from the database
      const pendingTasks = await storage.getTasksByStatus(req.session.userId!, 'pending');
      
      // For regular polling, only return tasks that haven't been displayed before
      // For manual refresh or initial load, return all pending tasks (since we've reset their status)
      const undisplayedTasks = isManualRefresh || isInitialLoad 
        ? pendingTasks 
        : await storage.getUndisplayedTasks(req.session.userId!);
        
      // Filter to only include pending tasks from our undisplayed set
      const filteredTasks = undisplayedTasks.filter(task => 
        task.status === 'pending' && pendingTasks.some(pt => pt.id === task.id)
      );
      
      // Mark these tasks as displayed in the database
      await Promise.all(filteredTasks.map(task => 
        storage.markTaskDisplayed(task.id, true)
      ));
      
      console.log(`Returning ${filteredTasks.length} of ${pendingTasks.length} pending tasks (${isManualRefresh ? 'manual refresh' : isInitialLoad ? 'initial load' : 'regular polling'})`);
      console.log(`${undisplayedTasks.length} total undisplayed tasks found`);
      
      // Format tasks to match the expected SlackMessage format from the frontend
      const formattedTasks = filteredTasks.map(task => ({
        user: user.slackUserId,
        text: task.title,
        ts: task.slackMessageId || String(task.id),
        channelId: task.slackChannelId || undefined,
        channelName: task.slackChannelId || 'Unknown Channel'
      }));
      
      // Flag to determine if we should automatically send DMs for detected tasks
      const sendDMs = req.query.sendDMs === 'true';
      
      // If requested, send interactive DMs for each detected task
      if (sendDMs) {
        // First test if we can send DMs to this user
        if (user.slackUserId) {
          console.log(`Testing DM capability for user ${user.slackUserId} before sending task notifications`);
          const canSendDM = await testDirectMessage(user.slackUserId);
          
          if (!canSendDM) {
            console.error(`Cannot send DMs to Slack user ${user.slackUserId}. Skipping all task notifications.`);
            return res.status(403).json({
              message: 'Cannot send DMs to your Slack account. This may be due to permission issues or Slack workspace settings.',
              code: 'SLACK_DM_PERMISSION_ERROR' 
            });
          }
          
          console.log(`Successfully tested DM capability for user ${user.slackUserId}, proceeding with task notifications`);
        }
      
        // Process each detected task from pending list
        await Promise.all(formattedTasks.map(async (task) => {
          try {
            // Send an interactive DM to the user about this detected task
            if (user.slackUserId) {
              console.log(`Sending task detection DM for task from message ${task.ts}`);
              // Use user token when available for better access to private channels/DMs
              await sendTaskDetectionDM(user.slackUserId, task, user.slackAccessToken || undefined);
            }
          } catch (dmError) {
            console.error('Error sending task detection DM:', dmError);
            console.error('Error details:', dmError.stack || 'No stack trace available');
            // Continue with other tasks even if one fails
          }
        }));
      }
      
      // Special case: If user explicitly requests a scan via the Force Scan button,
      // inform them that we're now using webhook-only mode
      if (req.query.forceScan === 'true') {
        return res.json({
          message: 'Using webhook-only mode for task detection',
          webhookStatus,
          tasks: formattedTasks,
          webhookMode: true
        });
      }
      
      res.json(formattedTasks);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to detect tasks from Slack' });
    }
  });
  
  // Handle Slack interactive components (buttons, etc.)
  // Create TWO endpoints for handling Slack interactive components:
  // 1. One at the API path (for backward compatibility)
  // 2. Another at the root path (which Slack likely expects)
  
  // API endpoint for Slack interactions
  app.post('/api/slack/interactions', express.json(), express.urlencoded({ extended: true }), async (req, res) => {
    try {
      // Handle Slack URL verification challenge (happens when setting up interactive components)
      if (req.body.type === 'url_verification') {
        console.log('Received Slack URL verification challenge for API interactions endpoint');
        return res.json({ challenge: req.body.challenge });
      }
      
      console.log('Received Slack interaction payload at API path');
      console.log('Body type:', typeof req.body);
      console.log('Body keys:', Object.keys(req.body));
      console.log('Content-Type:', req.headers['content-type']);
      console.log('Raw body:', JSON.stringify(req.body));
      
      // Slack sends form data with a 'payload' key containing a JSON string
      const payload = req.body.payload ? JSON.parse(req.body.payload) : null;
      
      if (!payload) {
        console.error('Invalid payload received from Slack:', req.body);
        return res.status(400).send('Invalid payload');
      }
      
      // Extract the action data
      const { type, user, actions } = payload;
      
      // Log the payload for debugging
      console.log('Slack interaction payload type:', type);
      console.log('Slack interaction actions:', actions ? actions.length : 0);
      
      // Process the action (just acknowledge for now to avoid 404s)
      console.log('Processing interaction at API path');
      
      // Acknowledge receipt immediately to avoid Slack timeout
      res.status(200).send('OK');
    } catch (error) {
      console.error('Error processing Slack interaction at API path:', error);
      res.status(500).send('Error processing interaction');
    }
  });
  
  // Test Slack DM capability
  app.get('/api/slack/test-dm', requireAuth, async (req, res) => {
    try {
      // Get the authenticated user
      const user = await storage.getUser(req.session.userId!);
      
      if (!user || !user.slackUserId) {
        return res.status(400).json({ 
          message: 'Slack integration not configured',
          code: 'SLACK_NOT_CONNECTED'
        });
      }
      
      // Test if we can send a DM to this user
      const canSendDM = await testDirectMessage(user.slackUserId);
      
      if (!canSendDM) {
        return res.status(403).json({
          message: 'Cannot send DMs to your Slack account. This may be due to permission issues or Slack workspace settings.',
          success: false,
          error: 'SLACK_DM_PERMISSION_ERROR'
        });
      }
      
      // Send a simple test message
      const messageText = "👋 This is a test message from your TaskFlow bot. If you're receiving this, the notification system is working properly!";
      
      // Use user token when available for better access to private channels/DMs
      const messageResult = await sendMessage(user.slackUserId, messageText, undefined, user.slackAccessToken || undefined);
      
      if (!messageResult) {
        return res.status(500).json({
          message: 'Failed to send test message to Slack',
          success: false,
          error: 'SEND_MESSAGE_FAILED'
        });
      }
      
      return res.status(200).json({
        message: 'Test message sent successfully!',
        success: true,
        details: 'You should now see a direct message from TaskFlow in your Slack app.'
      });
    } catch (error) {
      console.error('Error testing Slack DMs:', error);
      return res.status(500).json({
        message: 'An error occurred while testing Slack DMs',
        success: false,
        error: String(error)
      });
    }
  });
  
  // Root endpoint for Slack interactions
  app.post('/slack/interactions', express.json(), express.urlencoded({ extended: true }), async (req, res) => {
    try {
      console.log('[SLACK INTERACTION] Body keys:', Object.keys(req.body));
      console.log('[SLACK INTERACTION] Content-Type:', req.headers['content-type']);
      
      // Handle Slack URL verification challenge (happens when setting up interactive components)
      if (req.body.type === 'url_verification') {
        console.log('Received Slack URL verification challenge for interactive components');
        return res.json({ challenge: req.body.challenge });
      }
      
      console.log('Received Slack interaction payload at root path');
      console.log('Body type:', typeof req.body);
      console.log('Body keys:', Object.keys(req.body));
      console.log('Content-Type:', req.headers['content-type']);
      console.log('Raw body:', JSON.stringify(req.body));
      
      // Slack sends form data with a 'payload' key containing a JSON string
      const payload = req.body.payload ? JSON.parse(req.body.payload) : null;
      
      if (!payload) {
        console.error('Invalid payload received from Slack:', req.body);
        return res.status(400).send('Invalid payload');
      }

      // Extract the action data
      const { type, user, actions, channel, message, response_url } = payload;
      
      // Log the payload for debugging
      console.log('Slack interaction payload type:', type);
      console.log('Slack interaction actions:', actions ? actions.length : 0);
      console.log('Response URL available:', !!response_url);
      
      // For view_submissions, we need to send a special response format
      if (type === 'view_submission') {
        // Respond with empty object to acknowledge the submission
        res.status(200).json({});
      } else {
        // For other types, acknowledge receipt immediately to avoid Slack timeout
        res.status(200).send('OK');
      }
      
      // Verify we have the necessary data to process the interaction
      if (!user || !user.id) {
        console.error('Missing user information in Slack payload:', payload);
        return;
      }
      
      // Handle view submissions (modal form submission)
      if (type === 'view_submission') {
        try {
          console.log('Received view submission with callback_id:', payload.view.callback_id);
          
          if (payload.view.callback_id === 'task_details_modal') {
            // Parse the metadata from the view
            const metadata = JSON.parse(payload.view.private_metadata || '{}');
            console.log('Modal metadata:', metadata);
            
            // Get the form values
            const state = payload.view.state.values;
            
            // Extract task details from the form
            const title = state.task_title_block.task_title_input.value;
            const description = state.task_description_block.task_description_input.value;
            const dueDate = state.task_deadline_block.task_deadline_date.selected_date;
            const dueTime = state.task_deadline_time_block.task_deadline_time.selected_time;
            const urgencyValue = state.task_urgency_block.task_urgency_select.selected_option.value;
            const importanceValue = state.task_importance_block.task_importance_select.selected_option.value;
            const timeRequired = state.task_time_required_block.task_time_required_select.selected_option.value;
            
            // Get recurring option if provided
            let recurringPattern = 'none';
            if (state.task_recurring_block && 
                state.task_recurring_block.task_recurring_select && 
                state.task_recurring_block.task_recurring_select.selected_option) {
              recurringPattern = state.task_recurring_block.task_recurring_select.selected_option.value;
            }
            
            // Map urgency to priority value
            const urgencyToPriority: Record<string, string> = {
              '1': 'low',
              '2': 'low',
              '3': 'medium',
              '4': 'high',
              '5': 'high'
            };
            
            // Convert the numeric urgency to priority string
            const priority = urgencyToPriority[urgencyValue] || 'medium';
            
            console.log(`Task details from modal: Title: ${title}, Due: ${dueDate} at ${dueTime}, Urgency: ${urgencyValue}, Importance: ${importanceValue}, Time: ${timeRequired}`);
            
            // Look up the user by Slack ID
            const dbUserQuery = await storage.getUserBySlackUserId(user.id);
            if (!dbUserQuery) {
              console.error(`User with Slack ID ${user.id} not found in database`);
              return;
            }
            
            // Create a SlackMessage object with the data from metadata and form values
            const slackMessage = {
              ts: metadata.messageTs,
              text: metadata.text || "",
              user: user.id,
              channelId: metadata.channel,
              channelName: metadata.channelName || "a channel",
              customTitle: title,
              customPriority: priority as 'low' | 'medium' | 'high',
              customTimeRequired: timeRequired,
              customDueDate: dueDate,
              customDueTime: dueTime,
              customUrgency: parseInt(urgencyValue, 10),
              customImportance: parseInt(importanceValue, 10),
              customRecurringPattern: recurringPattern !== 'none' ? recurringPattern : null
            };
            
            console.log('Creating task for user ID:', dbUserQuery.id);
            
            // Create the task in the database
            const task = await createTaskFromSlackMessage(slackMessage, dbUserQuery.id);
            
            console.log('Task created successfully:', task.id);
            
            // Send confirmation to the user
            await slack.chat.postMessage({
              channel: user.id,
              text: `✅ Task "${title}" has been added to your tasks.`,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `✅ Task *"${title}"* has been added to your tasks.\n\n*Priority:* ${priority === 'high' ? ':red_circle: High' : priority === 'medium' ? ':large_yellow_circle: Medium' : ':large_green_circle: Low'}\n*Due:* ${dueDate} at ${dueTime}\n*Time Required:* ${timeRequired}\n${recurringPattern !== 'none' ? `*Recurring:* ${recurringPattern}` : ''}`
                  }
                }
              ]
            });
            
            // Process calendar integration as needed
            // This code will continue with the existing calendar integration logic...
          }
          
          // Return an empty response to close the modal
          return;
        } catch (error) {
          console.error('Error processing view submission:', error);
          return;
        }
      }
      
      // Handle button clicks and other block actions
      if (type !== 'block_actions' || !actions || actions.length === 0) {
        console.warn('Unsupported interaction type or missing actions', payload);
        return;
      }
      
      // Get the first action (button click, etc.)
      const action = actions[0];
      console.log('Processing action:', action.action_id);
      
      // Additional sanity checks
      if (!action || !action.action_id) {
        console.error('Invalid action data:', action);
        return;
      }
      
      // Look up the user by their Slack ID
      const dbUserQuery = await storage.getUserBySlackUserId(user.id);
      
      if (!dbUserQuery) {
        console.error(`No user found for Slack user ID: ${user.id}`);
        try {
          // Send failure message
          // Always use bot token here since we don't have a user associated with this Slack ID
          await sendMessage(user.id, 'Error: Your account isn\'t connected to TaskFlow. Please log in to the TaskFlow app and connect your Slack account.');
        } catch (msgError) {
          console.error('Failed to send error message to user:', msgError);
        }
        return;
      }
      
      // Handle different action types
      if (action.action_id === 'create_task_default') {
        // User clicked "Add to My Tasks" button to create a task with default settings
        try {
          console.log('Create default task action received');
          
          // Parse the task data from the button value
          const taskData = JSON.parse(action.value);
          
          if (!taskData.action || taskData.action !== 'create_task' || !taskData.messageTs || !taskData.channel) {
            console.error('Invalid task data from button click:', taskData);
            await sendMessage(user.id, 'Error: Could not create task due to missing data.');
            return;
          }
          
          console.log(`Creating task with default values for message ${taskData.messageTs} in channel ${taskData.channel}`);
          
          // Use the data from the button payload instead of querying Slack
          try {
            console.log('Using payload data to create task');
            
            // Create a SlackMessage object with the data from the button payload
            const slackMessage = {
              ts: taskData.messageTs,
              text: taskData.messageText || "",
              user: user.id, // Use the user who clicked the button
              channelId: taskData.channel,
              channelName: taskData.channelName || "a channel",
              // Use title from the button data or default to "Task from Slack"
              customTitle: taskData.title || "Task from Slack",
              // Set default priority to medium or use payload value if available
              customPriority: (taskData.priority || 'medium') as 'low' | 'medium' | 'high',
              // Set default time required to 1 hour or use payload value if available
              customTimeRequired: taskData.timeRequired || "1:00",
              // Set default due date to tomorrow or use payload value if available
              customDueDate: taskData.dueDate || formatDateForSlack(new Date(Date.now() + 86400000)), // Tomorrow
              // Set default due time to noon
              customDueTime: "12:00",
              // Set default urgency and importance to 3 (medium)
              customUrgency: 3,
              customImportance: 3,
              // No recurring pattern by default
              customRecurringPattern: null
            };
            
            console.log('Creating task for user ID:', dbUserQuery.id);
            
            // Create the task in the database
            const task = await createTaskFromSlackMessage(slackMessage, dbUserQuery.id);
            
            console.log('Task created successfully:', task.id);
            
            // Send confirmation to the user
            await slack.chat.postMessage({
              channel: user.id,
              text: `✅ Task "${slackMessage.customTitle}" has been added to your tasks with default settings.`,
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: `✅ Task *"${slackMessage.customTitle}"* has been added to your tasks.\n\n*Priority:* Medium\n*Due:* ${slackMessage.customDueDate} at 12:00\n*Time Required:* 1 hour`
                  }
                }
              ]
            });
            
            // Update the original message to indicate that action was taken
            if (response_url) {
              await axios.post(response_url, {
                replace_original: true,
                text: "Task has been added to your schedule!",
                blocks: [
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `:white_check_mark: *Task added to your schedule*\n\nYou've added the following task to your schedule with default settings:\n*${slackMessage.customTitle}*`
                    }
                  }
                ]
              });
            }
          } catch (error) {
            console.error('Error retrieving message details from Slack:', error);
            await sendMessage(user.id, 'Error: Failed to retrieve the original message details.');
            return;
          }
        } catch (error) {
          console.error('Error handling create_task_default action:', error);
          try {
            await sendMessage(user.id, 'Error: Failed to create task. Please try again or contact support.');
          } catch (msgError) {
            console.error('Failed to send error message to user:', msgError);
          }
        }
      } else if (action.action_id === 'customize_task') {
        // User clicked "Customize Details" button to modify task details before creating
        try {
          console.log('Customize task action received');
          
          // Parse the task data from the button value
          const taskData = JSON.parse(action.value);
          
          if (!taskData.action || taskData.action !== 'customize_task' || !taskData.messageTs || !taskData.channel) {
            console.error('Invalid task data from button click:', taskData);
            await sendMessage(user.id, 'Error: Could not customize task due to missing data.');
            return;
          }
          
          console.log(`Preparing customization form for message ${taskData.messageTs} in channel ${taskData.channel}`);
          
          // Use the data from the button payload instead of querying Slack
          try {
            console.log('Using payload data to populate customize task modal');
            
            // Use channel name from the payload
            const channelName = taskData.channelName || "a channel";
            
            // Use the message text from the payload
            const messageText = taskData.messageText || "";
            
            // Create modal with task details form
            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
            
            // Format tomorrow's date in YYYY-MM-DD for the date picker default
            const defaultDueDate = formatDateForSlack(tomorrow);
            
            // Create an interactive form for task details
            await slack.views.open({
              trigger_id: payload.trigger_id,
              view: {
                type: "modal",
                callback_id: "task_details_modal",
                private_metadata: JSON.stringify({
                  messageTs: taskData.messageTs,
                  channel: taskData.channel,
                  channelName: channelName,
                  text: messageText
                }),
                title: {
                  type: "plain_text",
                  text: "Task Details"
                },
                submit: {
                  type: "plain_text",
                  text: "Create & Schedule Task"
                },
                close: {
                  type: "plain_text",
                  text: "Cancel"
                },
                blocks: [
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `*Creating a task from a message in #${channelName}*`
                    }
                  },
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: `>${messageText.substring(0, 100)}${messageText.length > 100 ? '...' : ''}`
                    }
                  },
                  {
                    type: "input",
                    block_id: "task_title_block",
                    element: {
                      type: "plain_text_input",
                      action_id: "task_title_input",
                      initial_value: "Task from Slack"
                    },
                    label: {
                      type: "plain_text",
                      text: "Task Title"
                    }
                  },
                  {
                    type: "input",
                    block_id: "task_description_block",
                    optional: true,
                    element: {
                      type: "plain_text_input",
                      action_id: "task_description_input",
                      multiline: true,
                      initial_value: messageText
                    },
                    label: {
                      type: "plain_text",
                      text: "Description"
                    }
                  },
                  {
                    type: "input",
                    block_id: "task_deadline_block",
                    element: {
                      type: "datepicker",
                      action_id: "task_deadline_date",
                      initial_date: defaultDueDate
                    },
                    label: {
                      type: "plain_text",
                      text: "Due Date"
                    }
                  },
                  {
                    type: "input",
                    block_id: "task_deadline_time_block",
                    element: {
                      type: "timepicker",
                      action_id: "task_deadline_time",
                      initial_time: "12:00"
                    },
                    label: {
                      type: "plain_text",
                      text: "Due Time"
                    }
                  },
                  {
                    type: "input",
                    block_id: "task_urgency_block",
                    element: {
                      type: "static_select",
                      action_id: "task_urgency_select",
                      initial_option: {
                        text: {
                          type: "plain_text",
                          text: "Medium (3)"
                        },
                        value: "3"
                      },
                      options: [
                        {
                          text: {
                            type: "plain_text",
                            text: "Very Low (1)"
                          },
                          value: "1"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "Low (2)"
                          },
                          value: "2"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "Medium (3)"
                          },
                          value: "3"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "High (4)"
                          },
                          value: "4"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "Very High (5)"
                          },
                          value: "5"
                        }
                      ]
                    },
                    label: {
                      type: "plain_text",
                      text: "Urgency"
                    }
                  },
                  {
                    type: "input",
                    block_id: "task_importance_block",
                    element: {
                      type: "static_select",
                      action_id: "task_importance_select",
                      initial_option: {
                        text: {
                          type: "plain_text",
                          text: "Medium (3)"
                        },
                        value: "3"
                      },
                      options: [
                        {
                          text: {
                            type: "plain_text",
                            text: "Very Low (1)"
                          },
                          value: "1"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "Low (2)"
                          },
                          value: "2"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "Medium (3)"
                          },
                          value: "3"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "High (4)"
                          },
                          value: "4"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "Very High (5)"
                          },
                          value: "5"
                        }
                      ]
                    },
                    label: {
                      type: "plain_text",
                      text: "Importance"
                    }
                  },
                  {
                    type: "input",
                    block_id: "task_time_required_block",
                    element: {
                      type: "static_select",
                      action_id: "task_time_required_select",
                      initial_option: {
                        text: {
                          type: "plain_text",
                          text: "1 hour"
                        },
                        value: "1:00"
                      },
                      options: [
                        {
                          text: {
                            type: "plain_text",
                            text: "15 minutes"
                          },
                          value: "0:15"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "30 minutes"
                          },
                          value: "0:30"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "45 minutes"
                          },
                          value: "0:45"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "1 hour"
                          },
                          value: "1:00"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "1.5 hours"
                          },
                          value: "1:30"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "2 hours"
                          },
                          value: "2:00"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "3 hours"
                          },
                          value: "3:00"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "4 hours"
                          },
                          value: "4:00"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "8 hours (Full day)"
                          },
                          value: "8:00"
                        }
                      ]
                    },
                    label: {
                      type: "plain_text",
                      text: "Time Required"
                    }
                  },
                  {
                    type: "input",
                    block_id: "task_recurring_block",
                    optional: true,
                    element: {
                      type: "static_select",
                      action_id: "task_recurring_select",
                      initial_option: {
                        text: {
                          type: "plain_text",
                          text: "No repetition"
                        },
                        value: "none"
                      },
                      options: [
                        {
                          text: {
                            type: "plain_text",
                            text: "No repetition"
                          },
                          value: "none"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "Daily"
                          },
                          value: "daily"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "Weekly"
                          },
                          value: "weekly"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "Biweekly"
                          },
                          value: "biweekly"
                        },
                        {
                          text: {
                            type: "plain_text",
                            text: "Monthly"
                          },
                          value: "monthly"
                        }
                      ]
                    },
                    label: {
                      type: "plain_text",
                      text: "Recurring Pattern"
                    }
                  }
                ]
              }
            });
            
            // Update the original message to indicate that customization is in progress
            if (response_url) {
              await axios.post(response_url, {
                replace_original: true,
                text: "Customizing task details...",
                blocks: [
                  {
                    type: "section",
                    text: {
                      type: "mrkdwn",
                      text: ":pencil: *Customizing task details*\n\nPlease complete the form that appeared to customize your task."
                    }
                  }
                ]
              });
            }
          } catch (error) {
            console.error('Error retrieving message details or opening modal:', error);
            await sendMessage(user.id, 'Error: Failed to open the task details form. Please try again.');
            return;
          }
        } catch (error) {
          console.error('Error handling customize_task action:', error);
          try {
            await sendMessage(user.id, 'Error: Failed to open task customization form. Please try again or contact support.');
          } catch (msgError) {
            console.error('Failed to send error message to user:', msgError);
          }
        }
      } else if (action.action_id === 'ignore_task') {
        // User clicked "Ignore" button to dismiss the task suggestion
        try {
          console.log('Ignore task action received');
          
          // Parse the task data from the button value
          const taskData = JSON.parse(action.value);
          
          if (!taskData.action || taskData.action !== 'ignore_task' || !taskData.messageTs || !taskData.channel) {
            console.error('Invalid task data from button click:', taskData);
            await sendMessage(user.id, 'Error: Could not ignore task due to missing data.');
            return;
          }
          
          console.log(`Ignoring task suggestion for message ${taskData.messageTs} in channel ${taskData.channel}`);
          
          // Update the original message to indicate that the task was ignored
          if (response_url) {
            await axios.post(response_url, {
              replace_original: true,
              text: "Task ignored",
              blocks: [
                {
                  type: "section",
                  text: {
                    type: "mrkdwn",
                    text: ":x: *Task ignored*\n\nThis message has been dismissed and won't appear in your tasks."
                  }
                }
              ]
            });
          } else {
            // If response_url isn't available, send a new message
            await sendMessage(user.id, "Task ignored. I won't remind you about this message again.");
          }
          
          // Send a confirmation to the user's DM
          await slack.chat.postMessage({
            channel: user.id,
            text: "Task has been ignored",
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: ":x: Task ignored successfully. You can still create tasks manually from any message using the message context menu."
                }
              }
            ]
          });
        } catch (error) {
          console.error('Error handling ignore_task action:', error);
          try {
            await sendMessage(user.id, 'Error: Failed to ignore task. Please try again or contact support.');
          } catch (msgError) {
            console.error('Failed to send error message to user:', msgError);
          }
        }
      } else if (action.action_id === 'create_task_detailed') {
        // User clicked "Create & Schedule Task" button from the detailed form
        try {
          console.log('Create detailed task action received');
          console.log('Values from state:', payload.state?.values);
          
          // Parse the task data from the button value and state values
          const taskData = JSON.parse(action.value);
          
          // Get values from the form fields
          const title = payload.state.values.task_title_block.task_title_input.value;
          const dueDate = payload.state.values.task_deadline_block.task_deadline_date.selected_date;
          const dueTime = payload.state.values.task_deadline_time_block.task_deadline_time.selected_time;
          const urgencyValue = payload.state.values.task_urgency_block.task_urgency_select.selected_option.value;
          const importanceValue = payload.state.values.task_importance_block.task_importance_select.selected_option.value;
          const timeRequired = payload.state.values.task_time_required_block.task_time_required_select.selected_option.value;
          
          // Get optional values
          const description = payload.state.values.task_description_block?.task_description_input?.value || '';
          
          // Get recurring option if provided
          let recurringPattern = null;
          if (payload.state.values.task_recurring_block && 
              payload.state.values.task_recurring_block.task_recurring_select && 
              payload.state.values.task_recurring_block.task_recurring_select.selected_option) {
            recurringPattern = payload.state.values.task_recurring_block.task_recurring_select.selected_option.value;
          }
          
          // Map urgency to priority value
          const urgencyToPriority: Record<string, string> = {
            '1': 'low',
            '2': 'low',
            '3': 'medium',
            '4': 'high',
            '5': 'high'
          };
          
          // Convert the numeric urgency to priority string
          const priority = urgencyToPriority[urgencyValue] || 'medium';
          
          console.log(`Task details received: Title: ${title}, Due: ${dueDate} at ${dueTime}, Urgency: ${urgencyValue}, Importance: ${importanceValue}, Time: ${timeRequired}`);
          console.log(`Additional details: Description: ${description?.substring(0, 50)}${description?.length > 50 ? '...' : ''}, Recurring: ${recurringPattern || 'none'}`);
          
          // Create a SlackMessage object with the enhanced task data
          const slackMessage = {
            ts: taskData.ts,
            text: taskData.text,
            user: taskData.user,
            channelId: taskData.channelId,
            channelName: taskData.channelName,
            // Add custom values from the form
            customTitle: title,
            customDescription: description || undefined,
            customPriority: priority as 'low' | 'medium' | 'high',
            customTimeRequired: timeRequired,
            customDueDate: dueDate,
            customDueTime: dueTime,
            customUrgency: parseInt(urgencyValue, 10),
            customImportance: parseInt(importanceValue, 10),
            // Add recurring pattern (null if 'none' was selected)
            customRecurringPattern: recurringPattern !== 'none' ? recurringPattern : null
          };
          
          console.log('Creating task for user ID:', dbUserQuery.id);
          
          // Create the task in the database
          const task = await createTaskFromSlackMessage(slackMessage, dbUserQuery.id);
          
          console.log('Task created successfully:', task.id);
          
          // Find available time slot in Google Calendar based on task details
          const user = await storage.getUser(dbUserQuery.id);
          
          // If the user has Google Calendar connected, attempt to find an optimal slot and schedule
          if (user?.googleRefreshToken && user.googleRefreshToken.trim() !== '') {
            try {
              // Use working hours if available, otherwise use default business hours
              const workingHours = await storage.getWorkingHours(dbUserQuery.id);
              
              // Get importance and urgency from the form
              const importance = parseInt(importanceValue, 10);
              const urgency = parseInt(urgencyValue, 10);
              
              // Parse time required into minutes
              const [reqHours, reqMinutes] = timeRequired.split(':').map(Number);
              const durationMinutes = (reqHours * 60) + reqMinutes;
              
              console.log(`Finding optimal time slot with parameters: Importance=${importance}, Urgency=${urgency}, Duration=${durationMinutes} minutes`);
              
              // Determine scheduling window based on urgency
              const now = new Date();
              const dueDateTime = new Date(`${dueDate}T${dueTime}`);
              
              // Calculate scheduling window - more urgent tasks get a tighter window
              const daysToDeadline = Math.max(1, Math.ceil((dueDateTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
              const schedulingWindowDays = Math.min(
                daysToDeadline, 
                urgency === 5 ? 1 : // Very urgent: Today only
                urgency === 4 ? 2 : // Urgent: Within 2 days
                urgency === 3 ? 3 : // Moderate: Within 3 days
                urgency === 2 ? 5 : // Low urgency: Within 5 days
                7 // Very low urgency: Within a week
              );
              
              console.log(`Scheduling window: ${schedulingWindowDays} days (${daysToDeadline} days to deadline)`);
              
              // Set time window to look for available slots
              const timeMin = now.toISOString().replace('Z', '');
              const schedulingEndDate = new Date(now);
              schedulingEndDate.setDate(schedulingEndDate.getDate() + schedulingWindowDays);
              const timeMax = schedulingEndDate.toISOString().replace('Z', '');
              
              // Fetch existing calendar events to find gaps
              const existingEvents = await listCalendarEvents(
                user.googleRefreshToken,
                timeMin,
                timeMax
              );
              
              console.log(`Found ${existingEvents.length} existing events in the scheduling window`);
              
              // Determine working hours for each day
              const defaultStart = workingHours?.startTime || '09:00';
              const defaultEnd = workingHours?.endTime || '17:00';
              
              // Find an optimal slot based on working hours and existing events
              let foundSlot = false;
              let scheduledStart: Date | null = null;
              let scheduledEnd: Date | null = null;
              
              // Start by trying to schedule today, then move forward
              for (let day = 0; day < schedulingWindowDays && !foundSlot; day++) {
                const currentDate = new Date(now);
                currentDate.setDate(currentDate.getDate() + day);
                
                // Skip weekends if specified in working hours
                const dayOfWeek = currentDate.getDay(); // 0 is Sunday, 6 is Saturday
                if (workingHours && (
                  (dayOfWeek === 0 && !workingHours.sunday) ||
                  (dayOfWeek === 1 && !workingHours.monday) ||
                  (dayOfWeek === 2 && !workingHours.tuesday) ||
                  (dayOfWeek === 3 && !workingHours.wednesday) ||
                  (dayOfWeek === 4 && !workingHours.thursday) ||
                  (dayOfWeek === 5 && !workingHours.friday) ||
                  (dayOfWeek === 6 && !workingHours.saturday)
                )) {
                  console.log(`Skipping day ${currentDate.toISOString().split('T')[0]} - not a working day`);
                  continue;
                }
                
                // Set working hours start/end for this day
                const workingStart = new Date(`${currentDate.toISOString().split('T')[0]}T${defaultStart}`);
                const workingEnd = new Date(`${currentDate.toISOString().split('T')[0]}T${defaultEnd}`);
                
                // Adjust for current time if this is today
                if (day === 0) {
                  // For today, don't try to schedule in the past
                  if (now > workingStart) {
                    // Start from now if within working hours, or next day
                    if (now < workingEnd) {
                      workingStart.setTime(now.getTime());
                    } else {
                      // Past working hours for today, skip to tomorrow
                      continue;
                    }
                  }
                }
                
                // Get events only for this day
                const dayStart = new Date(currentDate);
                dayStart.setHours(0, 0, 0, 0);
                
                const dayEnd = new Date(currentDate);
                dayEnd.setHours(23, 59, 59, 999);
                
                const dayEvents = existingEvents.filter(event => {
                  const eventStart = event.start?.dateTime ? new Date(event.start.dateTime) : null;
                  return eventStart && eventStart >= dayStart && eventStart <= dayEnd;
                });
                
                console.log(`Checking day ${currentDate.toISOString().split('T')[0]} - ${dayEvents.length} events`);
                
                // Sort events by start time
                dayEvents.sort((a, b) => {
                  const aStart = a.start?.dateTime ? new Date(a.start.dateTime).getTime() : 0;
                  const bStart = b.start?.dateTime ? new Date(b.start.dateTime).getTime() : 0;
                  return aStart - bStart;
                });
                
                // Find gaps between events
                let potentialStart = new Date(workingStart);
                
                for (let i = 0; i <= dayEvents.length; i++) {
                  const gapEnd = i < dayEvents.length && dayEvents[i].start?.dateTime 
                    ? new Date(dayEvents[i].start.dateTime) 
                    : workingEnd;
                  
                  const gapDuration = (gapEnd.getTime() - potentialStart.getTime()) / (1000 * 60);
                  
                  if (gapDuration >= durationMinutes) {
                    // We found a gap that fits our task!
                    scheduledStart = new Date(potentialStart);
                    foundSlot = true;
                    break;
                  }
                  
                  // Move to the end of this event for the next gap
                  if (i < dayEvents.length && dayEvents[i].end?.dateTime) {
                    potentialStart = new Date(dayEvents[i].end.dateTime);
                  }
                }
                
                if (foundSlot) {
                  console.log(`Found available slot on ${scheduledStart!.toISOString().replace('Z', '')}`);
                  break;
                }
              }
              
              // If we found a slot, create calendar event
              if (foundSlot && scheduledStart) {
                scheduledEnd = new Date(scheduledStart);
                scheduledEnd.setMinutes(scheduledEnd.getMinutes() + durationMinutes);
                
                // Get user's timezone preference directly from user settings
                // The timezone is already stored in the user record in IANA format
                // Google Calendar requires valid IANA timezone strings like 'America/New_York'
                const userTimeZone = user.timezone || 'UTC';
                console.log(`Using user's stored timezone for calendar event: ${userTimeZone}`);
                
                // Check if this is a recurring task
                const recurringPattern = message.customRecurringPattern || null;
                
                // Prepare event data
                const eventData: any = {
                  summary: `Task: ${title}`,
                  description: `${task.description || taskData.text}\n\nScheduled by TaskFlow\nUrgency: ${urgency}/5\nImportance: ${importance}/5`,
                  start: {
                    dateTime: scheduledStart.toISOString().replace('Z', ''),
                    timeZone: userTimeZone
                  },
                  end: {
                    dateTime: scheduledEnd.toISOString().replace('Z', ''),
                    timeZone: userTimeZone
                  },
                  colorId: priority === 'high' ? '4' : priority === 'medium' ? '5' : '6', // Red, Yellow, Green
                };
                
                // Add recurrence rule if this is a recurring task
                if (recurringPattern) {
                  console.log(`Creating recurring event with pattern: ${recurringPattern}`);
                  
                  // Map our simplified patterns to RRULE format
                  // https://tools.ietf.org/html/rfc5545#section-3.8.5
                  if (recurringPattern === 'daily') {
                    eventData.recurrence = ['RRULE:FREQ=DAILY'];
                  } else if (recurringPattern === 'weekly') {
                    eventData.recurrence = ['RRULE:FREQ=WEEKLY'];
                  } else if (recurringPattern === 'biweekly') {
                    eventData.recurrence = ['RRULE:FREQ=WEEKLY;INTERVAL=2'];
                  } else if (recurringPattern === 'monthly') {
                    eventData.recurrence = ['RRULE:FREQ=MONTHLY'];
                  } else {
                    console.log(`Unknown recurring pattern: ${recurringPattern}, treating as non-recurring`);
                  }
                }
                
                console.log('[CALENDAR_INTEGRATION] About to create calendar event with the following data:');
                console.log(JSON.stringify(eventData, null, 2));
                
                try {
                  const event = await createCalendarEvent(
                    user.googleRefreshToken,
                    eventData
                  );
                  
                  // Update task with Google Calendar event ID
                  if (event?.id) {
                    await storage.updateTask(task.id, { 
                      googleEventId: event.id,
                      scheduledStart: scheduledStart.toISOString().replace('Z', ''),
                      scheduledEnd: scheduledEnd.toISOString().replace('Z', ''),
                      status: 'scheduled'
                    });
                    
                    console.log(`[CALENDAR_INTEGRATION] Successfully scheduled task in calendar at ${scheduledStart.toISOString().replace('Z', '')}`);
                    console.log(`[CALENDAR_INTEGRATION] Google Calendar event ID: ${event.id}`);
                  } else {
                    console.warn('[CALENDAR_INTEGRATION] Event created but no ID returned');
                    await storage.updateTaskStatus(task.id, 'accepted');
                  }
                } catch (calendarError) {
                  console.error('[CALENDAR_INTEGRATION] Failed to create calendar event:', calendarError);
                  
                  if (calendarError instanceof TokenExpiredError) {
                    console.warn('[CALENDAR_INTEGRATION] Google Calendar token has expired');
                    // You could notify the user that their token has expired
                  }
                  
                  // Still mark the task as accepted even if calendar integration fails
                  await storage.updateTaskStatus(task.id, 'accepted');
                }
              } else {
                console.log('Could not find a suitable time slot within the scheduling window');
                
                // Even if we couldn't find a slot, we still create a deadline-focused event
                // at the deadline time minus task duration
                const deadlineStart = new Date(dueDateTime);
                deadlineStart.setMinutes(deadlineStart.getMinutes() - durationMinutes);
                
                console.log(`Using deadline-based scheduling: ${deadlineStart.toISOString().replace('Z', '')} to ${dueDateTime.toISOString().replace('Z', '')}`);
                
                // Get user's timezone preference directly from user settings
                // The timezone is already stored in the user record in IANA format
                // Google Calendar requires valid IANA timezone strings like 'America/New_York'
                const userTimeZone = user.timezone || 'UTC';
                console.log(`Using user's stored timezone for calendar event: ${userTimeZone}`);
                
                // Check if this is a recurring task
                const recurringPattern = message.customRecurringPattern || null;
                
                // Prepare event data for deadline-based scheduling
                const eventData: any = {
                  summary: `DEADLINE: ${title}`,
                  description: `${task.description || taskData.text}\n\nAuto-scheduled by TaskFlow (no suitable slots found)\nUrgency: ${urgency}/5\nImportance: ${importance}/5`,
                  start: {
                    dateTime: deadlineStart.toISOString().replace('Z', ''),
                    timeZone: userTimeZone
                  },
                  end: {
                    dateTime: dueDateTime.toISOString().replace('Z', ''),
                    timeZone: userTimeZone
                  },
                  colorId: '11', // Red for deadline-based scheduling
                };
                
                // Add recurrence rule if this is a recurring task
                if (recurringPattern) {
                  console.log(`Creating recurring deadline event with pattern: ${recurringPattern}`);
                  
                  // Map our simplified patterns to RRULE format
                  if (recurringPattern === 'daily') {
                    eventData.recurrence = ['RRULE:FREQ=DAILY'];
                  } else if (recurringPattern === 'weekly') {
                    eventData.recurrence = ['RRULE:FREQ=WEEKLY'];
                  } else if (recurringPattern === 'biweekly') {
                    eventData.recurrence = ['RRULE:FREQ=WEEKLY;INTERVAL=2'];
                  } else if (recurringPattern === 'monthly') {
                    eventData.recurrence = ['RRULE:FREQ=MONTHLY'];
                  }
                }
                
                console.log('[CALENDAR_INTEGRATION] About to create deadline-based calendar event with the following data:');
                console.log(JSON.stringify(eventData, null, 2));
                
                try {
                  const event = await createCalendarEvent(
                    user.googleRefreshToken,
                    eventData
                  );
                  
                  // Update task with Google Calendar event ID
                  if (event?.id) {
                    await storage.updateTask(task.id, { 
                      googleEventId: event.id,
                      scheduledStart: deadlineStart.toISOString().replace('Z', ''),
                      scheduledEnd: dueDateTime.toISOString().replace('Z', ''),
                      status: 'scheduled'
                    });
                    
                    console.log(`[CALENDAR_INTEGRATION] Successfully created deadline-based calendar event at ${deadlineStart.toISOString().replace('Z', '')}`);
                    console.log(`[CALENDAR_INTEGRATION] Google Calendar event ID: ${event.id}`);
                  } else {
                    console.warn('[CALENDAR_INTEGRATION] Deadline event created but no ID returned');
                    await storage.updateTaskStatus(task.id, 'accepted');
                  }
                } catch (calendarError) {
                  console.error('[CALENDAR_INTEGRATION] Failed to create deadline-based calendar event:', calendarError);
                  
                  if (calendarError instanceof TokenExpiredError) {
                    console.warn('[CALENDAR_INTEGRATION] Google Calendar token has expired');
                    // You could notify the user that their token has expired
                  }
                  
                  // Still mark the task as accepted even if calendar integration fails
                  await storage.updateTaskStatus(task.id, 'accepted');
                }
              }
            } catch (error) {
              console.error('Failed to schedule task in Google Calendar:', error);
            }
          } else {
            console.log('User does not have Google Calendar connected, skipping calendar scheduling');
          }
          
          // Use the response_url to update the original message if available
          if (response_url) {
            try {
              // Check if the response_url is a valid URL (for development environment testing)
              if (response_url.startsWith('http')) {
                try {
                  // Make direct request to response_url
                  const updateResponse = await fetch(response_url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      text: 'Task created and scheduled successfully!',
                      replace_original: true
                    })
                  });
                  console.log('Response URL update status:', updateResponse.status);
                } catch (fetchError) {
                  // Don't let this error break the flow, just log it
                  console.log('Could not reach Slack response_url (expected in development):', fetchError.message);
                }
              } else {
                console.log('Skipping response_url update: URL appears invalid');
              }
            } catch (updateError) {
              console.error('Error handling response_url update:', updateError);
            }
          }
          
          // Send confirmation to the user using the bot token
          await sendTaskConfirmation(
            task,
            user.id, // Send directly to the user as a DM
            true
          );
        } catch (error) {
          console.error('Error creating task from detailed interaction:', error);
          // Use user token if available, otherwise fall back to bot token
          await sendMessage(user.id, 'Sorry, there was an error creating your task. Please try again.', undefined, dbUserQuery.slackAccessToken || undefined);
        }
      } else if (action.action_id === 'create_task') {
        // Legacy handler for the simple "Create Task" button (keeping for backward compatibility)
        try {
          console.log('Create task action value:', action.value);
          
          // Parse the task data from the button value
          const taskData = JSON.parse(action.value);
          
          // Create a SlackMessage object with the task data
          const slackMessage = {
            ts: taskData.ts,
            text: taskData.text,
            user: taskData.user,
            channelId: taskData.channelId,
            channelName: taskData.channelName,
            // Add custom values for task creation
            customTitle: taskData.title,
            customPriority: taskData.priority,
            customTimeRequired: taskData.timeRequired,
            customDueDate: taskData.dueDate,
            customDueTime: taskData.dueTime
          };
          
          console.log('Creating task for user ID:', dbUserQuery.id);
          
          // Create the task in the database
          const task = await createTaskFromSlackMessage(slackMessage, dbUserQuery.id);
          
          console.log('Task created successfully:', task.id);
          
          // Use the response_url to update the original message if available
          if (response_url) {
            try {
              // Check if the response_url is a valid URL (for development environment testing)
              if (response_url.startsWith('http')) {
                try {
                  // Make direct request to response_url
                  const updateResponse = await fetch(response_url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      text: 'Task created successfully!',
                      replace_original: true
                    })
                  });
                  console.log('Response URL update status:', updateResponse.status);
                } catch (fetchError) {
                  // Don't let this error break the flow, just log it
                  console.log('Could not reach Slack response_url (expected in development):', fetchError.message);
                }
              } else {
                console.log('Skipping response_url update: URL appears invalid');
              }
            } catch (updateError) {
              console.error('Error handling response_url update:', updateError);
            }
          }
          
          // Send confirmation to the user using the bot token
          // We always use bot token for task confirmations for consistent branding
          await sendTaskConfirmation(
            task,
            user.id, // Send directly to the user as a DM
            true
          );
        } catch (error) {
          console.error('Error creating task from interaction:', error);
          // Use user token if available, otherwise fall back to bot token
          await sendMessage(user.id, 'Sorry, there was an error creating your task. Please try again.', undefined, dbUserQuery.slackAccessToken || undefined);
        }
      } else if (action.action_id === 'ignore_task') {
        // User clicked "Ignore" button
        try {
          console.log('Ignore task action value:', action.value);
          
          // Parse the task data from the button value
          const taskData = JSON.parse(action.value);
          
          console.log('Ignoring task for message:', taskData.ts);

          // Update the task status to "ignored" in the database if it exists
          if (taskData.ts) {
            const task = await storage.getTasksBySlackMessageId(taskData.ts);
            if (task) {
              await storage.updateTaskStatus(task.id, 'ignored');
              console.log(`Task ${task.id} from message ${taskData.ts} marked as ignored`);
            } else {
              // If the task doesn't exist yet in the database, create it with "ignored" status
              // This ensures we won't process this message again
              const pendingTask = await storage.createPendingTask(
                dbUserQuery.id, 
                taskData.ts, 
                taskData.channelId || message?.channel?.id || 'unknown-channel',
                'Ignored task'
              );
              console.log('Created pending task:', pendingTask.id);
              
              // Then update its status to ignored
              await storage.updateTaskStatus(pendingTask.id, 'ignored');
              console.log(`Updated pending task ${pendingTask.id} to ignored`);
            }
          }
          
          // Use the response_url to update the original message if available
          if (response_url) {
            try {
              // Check if the response_url is a valid URL (for development environment testing)
              if (response_url.startsWith('http')) {
                try {
                  // Make direct request to response_url
                  const updateResponse = await fetch(response_url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      text: 'Task ignored.',
                      replace_original: true
                    })
                  });
                  console.log('Response URL update status:', updateResponse.status);
                } catch (fetchError) {
                  // Don't let this error break the flow, just log it
                  console.log('Could not reach Slack response_url (expected in development):', fetchError.message);
                }
              } else {
                console.log('Skipping response_url update: URL appears invalid');
              }
            } catch (updateError) {
              console.error('Error handling response_url update:', updateError);
            }
          }
          
          // Send acknowledgment message as a separate DM
          // Use user token if available, otherwise fall back to bot token
          await sendMessage(
            user.id,
            'Task ignored. I won\'t remind you about this message again.',
            undefined,
            dbUserQuery.slackAccessToken || undefined
          );
        } catch (error) {
          console.error('Error processing ignore task action:', error);
        }
      } else if (action.action_id === 'edit_task') {
        // User clicked "Edit details" button
        try {
          console.log('Edit task action value:', action.value);
          
          // Parse the task data from the button value
          const taskData = JSON.parse(action.value);
          
          // In a real implementation, this would open a dialog to edit task details
          // For now, just acknowledge the action
          // Use user token if available, otherwise fall back to bot token
          await sendMessage(
            user.id,
            'This feature is coming soon! In the meantime, you can edit tasks from the TaskFlow dashboard.',
            undefined,
            dbUserQuery.slackAccessToken || undefined
          );
        } catch (error) {
          console.error('Error handling edit task action:', error);
        }
      }
    } catch (error) {
      console.error('Error processing Slack interaction:', error);
    }
  });
  
  // Create a task from a Slack message
  app.post('/api/slack/create-task', requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      
      if (!user || !user.slackUserId) {
        return res.status(400).json({ message: 'Slack integration not configured' });
      }
      
      // Validate the incoming message data
      const { message } = z.object({
        message: z.object({
          ts: z.string(),
          text: z.string(),
          user: z.string(),
          channelId: z.string().optional(),
          channel: z.string().optional(),
          channelName: z.string().optional(),
          user_profile: z.object({
            image_72: z.string().optional(),
            display_name: z.string().optional(),
            real_name: z.string().optional()
          }).optional(),
          // Optional custom fields for task creation
          customTitle: z.string().optional(),
          customDescription: z.string().optional(),
          customPriority: z.enum(['high', 'medium', 'low']).optional(),
          customTimeRequired: z.string().optional(),
          customDueDate: z.string().optional(),
          customDueTime: z.string().optional()
        })
      }).parse(req.body);
      
      // Create a task from the Slack message
      const task = await createTaskFromSlackMessage(message, req.session.userId!);
      
      // Always send a confirmation message as a DM to the user using the bot token
      await sendTaskConfirmation(
        task, 
        message.channelId || '', 
        true // Force sending as DM
      );
      
      res.status(201).json(task);
    } catch (error) {
      console.error('Error creating task from Slack message:', error);
      res.status(500).json({ message: 'Failed to create task from Slack message' });
    }
  });
  
  // Working hours routes
  app.get('/api/working-hours', requireAuth, async (req, res) => {
    try {
      const workingHours = await storage.getWorkingHours(req.session.userId!);
      
      if (!workingHours) {
        return res.status(404).json({ message: 'Working hours not found' });
      }
      
      res.json(workingHours);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server error' });
    }
  });
  
  app.patch('/api/working-hours', requireAuth, async (req, res) => {
    try {
      const workingHoursData = insertWorkingHoursSchema.partial().parse(req.body);
      const existingWorkingHours = await storage.getWorkingHours(req.session.userId!);
      
      if (!existingWorkingHours) {
        return res.status(404).json({ message: 'Working hours not found' });
      }
      
      const updatedWorkingHours = await storage.updateWorkingHours(existingWorkingHours.id, workingHoursData);
      res.json(updatedWorkingHours);
    } catch (error) {
      console.error(error);
      res.status(400).json({ message: 'Invalid working hours data' });
    }
  });
  
  // Task routes
  app.get('/api/tasks', requireAuth, async (req, res) => {
    try {
      const tasks = await storage.getTasksByUser(req.session.userId!);
      res.json(tasks);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server error' });
    }
  });
  
  app.get('/api/tasks/today', requireAuth, async (req, res) => {
    try {
      const today = new Date().toISOString().split('T')[0];
      const tasks = await storage.getTasksByDate(req.session.userId!, today);
      res.json(tasks);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Server error' });
    }
  });
  
  // Endpoint for retrieving the most recent tasks (for notifications)
  app.get('/api/tasks/recent', requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 5;
      
      // Get all tasks for the user
      const allTasks = await storage.getTasksByUser(userId);
      
      // Sort by created date, newest first
      const sortedTasks = allTasks.sort((a, b) => {
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      });
      
      // Return only the requested number of tasks
      res.json(sortedTasks.slice(0, limit));
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to fetch recent tasks' });
    }
  });
  
  app.get('/api/tasks/:date', requireAuth, async (req, res) => {
    try {
      const { date } = z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
      }).parse(req.params);
      
      const tasks = await storage.getTasksByDate(req.session.userId!, date);
      res.json(tasks);
    } catch (error) {
      console.error(error);
      res.status(400).json({ message: 'Invalid date format' });
    }
  });
  
  app.post('/api/tasks', requireAuth, async (req, res) => {
    try {
      const taskData = insertTaskSchema
        .omit({ userId: true })
        .parse(req.body);
      
      const user = await storage.getUser(req.session.userId!);
      
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      const task = await storage.createTask({
        ...taskData,
        userId: req.session.userId!
      });
      
      // If user has Google Calendar integrated, create calendar event
      if (user.googleRefreshToken && user.googleRefreshToken.trim() !== '' && 
          task.dueDate && task.dueTime && task.timeRequired) {
        try {
          // Parse time required into hours and minutes
          const [hours, minutes] = task.timeRequired.split(':').map(Number);
          const durationMs = (hours * 60 + minutes) * 60 * 1000;
          
          // Create start time from due date and time
          const startTime = new Date(`${task.dueDate}T${task.dueTime}`);
          const endTime = new Date(startTime.getTime() + durationMs);
          
          // Get user's timezone from Slack if available
          let userTimeZone = 'UTC';
          if (user.slackUserId) {
            try {
              const { timezone } = await getUserTimezone(user.slackUserId);
              userTimeZone = timezone;
              console.log(`Using user's Slack timezone for calendar event: ${userTimeZone}`);
            } catch (err) {
              console.error('Error getting user timezone from Slack, falling back to UTC:', err);
            }
          }
          
          // Prepare the event data
          const eventData = {
            summary: task.title,
            description: task.description || undefined,
            start: {
              dateTime: startTime.toISOString().replace('Z', ''),
              timeZone: userTimeZone
            },
            end: {
              dateTime: endTime.toISOString().replace('Z', ''),
              timeZone: userTimeZone
            }
          };
          
          console.log('[CALENDAR_INTEGRATION] About to create manual calendar event with the following data:');
          console.log(JSON.stringify(eventData, null, 2));
          
          const event = await createCalendarEvent(user.googleRefreshToken, eventData);
          
          if (event?.id) {
            // Update task with Google Calendar event ID and mark as scheduled
            await storage.updateTask(task.id, {
              googleEventId: event.id,
              scheduledStart: startTime.toISOString().replace('Z', ''),
              scheduledEnd: endTime.toISOString().replace('Z', ''),
              status: 'scheduled'
            });
            
            console.log(`[CALENDAR_INTEGRATION] Successfully created manual calendar event at ${startTime.toISOString().replace('Z', '')}`);
            console.log(`[CALENDAR_INTEGRATION] Google Calendar event ID: ${event.id}`);
          } else {
            console.warn('[CALENDAR_INTEGRATION] Manual event created but no ID returned');
            await storage.updateTaskStatus(task.id, 'accepted');
          }
        } catch (error) {
          console.error('Failed to create Google Calendar event:', error);
          
          // Check if this is a token expired error
          if (error instanceof TokenExpiredError) {
            console.warn('Google Calendar token has expired');
            // We don't want to fail the task creation entirely, just log the error
          } else {
            console.error('Other error creating calendar event:', error);
          }
        }
      }
      
      res.status(201).json(task);
    } catch (error) {
      console.error(error);
      res.status(400).json({ message: 'Invalid task data' });
    }
  });
  
  app.patch('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
      const { id } = z.object({
        id: z.string().transform(Number)
      }).parse(req.params);
      
      const taskData = insertTaskSchema
        .omit({ userId: true })
        .partial()
        .parse(req.body);
      
      const task = await storage.getTask(id);
      
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }
      
      if (task.userId !== req.session.userId) {
        return res.status(403).json({ message: 'Not authorized to update this task' });
      }
      
      const updatedTask = await storage.updateTask(id, taskData);
      
      // Update Google Calendar event if it exists
      const user = await storage.getUser(req.session.userId!);
      if (user && user.googleRefreshToken && user.googleRefreshToken.trim() !== '' && 
          updatedTask?.googleEventId && 
          (taskData.title || taskData.description || taskData.dueDate || taskData.dueTime || taskData.timeRequired)) {
        try {
          const eventUpdate: any = {};
          
          if (taskData.title) {
            eventUpdate.summary = taskData.title;
          }
          
          if (taskData.description) {
            eventUpdate.description = taskData.description;
          }
          
          if ((taskData.dueDate || taskData.dueTime) && updatedTask.dueDate && updatedTask.dueTime) {
            // Parse time required into hours and minutes
            const [hours, minutes] = (updatedTask.timeRequired || '01:00').split(':').map(Number);
            const durationMs = (hours * 60 + minutes) * 60 * 1000;
            
            // Create start time from due date and time
            const startTime = new Date(`${updatedTask.dueDate}T${updatedTask.dueTime}`);
            const endTime = new Date(startTime.getTime() + durationMs);
            
            // Get user's timezone from Slack if available
            let userTimeZone = 'UTC';
            if (user.slackUserId) {
              try {
                const { timezone } = await getUserTimezone(user.slackUserId);
                userTimeZone = timezone;
                console.log(`Using user's Slack timezone for calendar event update: ${userTimeZone}`);
              } catch (err) {
                console.error('Error getting user timezone from Slack, falling back to UTC:', err);
              }
            }
            
            eventUpdate.start = {
              dateTime: startTime.toISOString().replace('Z', ''),
              timeZone: userTimeZone
            };
            
            eventUpdate.end = {
              dateTime: endTime.toISOString().replace('Z', ''),
              timeZone: userTimeZone
            };
          }
          
          if (Object.keys(eventUpdate).length > 0) {
            await updateCalendarEvent(user.googleRefreshToken, updatedTask.googleEventId, eventUpdate);
          }
        } catch (error) {
          console.error('Failed to update Google Calendar event:', error);
          
          // Check if this is a token expired error
          if (error instanceof TokenExpiredError) {
            console.warn('Google Calendar token has expired');
            // We don't want to fail the task update entirely, just log the error
          } else {
            console.error('Other error updating calendar event:', error);
          }
        }
      }
      
      res.json(updatedTask);
    } catch (error) {
      console.error(error);
      res.status(400).json({ message: 'Invalid task data' });
    }
  });
  
  app.delete('/api/tasks/:id', requireAuth, async (req, res) => {
    try {
      const { id } = z.object({
        id: z.string().transform(Number)
      }).parse(req.params);
      
      const task = await storage.getTask(id);
      
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }
      
      if (task.userId !== req.session.userId) {
        return res.status(403).json({ message: 'Not authorized to delete this task' });
      }
      
      // Delete from Google Calendar if it exists
      if (task.googleEventId) {
        const user = await storage.getUser(req.session.userId!);
        if (user && user.googleRefreshToken && user.googleRefreshToken.trim() !== '') {
          try {
            await deleteCalendarEvent(user.googleRefreshToken, task.googleEventId);
          } catch (error) {
            console.error('Failed to delete Google Calendar event:', error);
            
            // Check if this is a token expired error
            if (error instanceof TokenExpiredError) {
              console.warn('Google Calendar token has expired');
              // We don't want to fail the task deletion entirely, just log the error
            } else {
              console.error('Other error deleting calendar event:', error);
            }
          }
        }
      }
      
      await storage.deleteTask(id);
      res.status(204).send();
    } catch (error) {
      console.error(error);
      res.status(400).json({ message: 'Invalid task ID' });
    }
  });
  
  app.post('/api/tasks/:id/complete', requireAuth, async (req, res) => {
    try {
      const { id } = z.object({
        id: z.string().transform(Number)
      }).parse(req.params);
      
      const { completed } = z.object({
        completed: z.boolean()
      }).parse(req.body);
      
      const task = await storage.getTask(id);
      
      if (!task) {
        return res.status(404).json({ message: 'Task not found' });
      }
      
      if (task.userId !== req.session.userId) {
        return res.status(403).json({ message: 'Not authorized to update this task' });
      }
      
      const updatedTask = await storage.markTaskComplete(id, completed);
      res.json(updatedTask);
    } catch (error) {
      console.error(error);
      res.status(400).json({ message: 'Invalid request' });
    }
  });
  
  // Calendar routes
  app.get('/api/calendar/events', requireAuth, async (req, res) => {
    try {
      // Validate request parameters
      const { start, end } = z.object({
        start: z.string(),
        end: z.string()
      }).parse(req.query);
      
      // Get the user
      const user = await storage.getUser(req.session.userId!);
      
      // Check if user exists and has Google Calendar connected
      if (!user) {
        return res.status(404).json({ 
          message: 'User not found', 
          code: ErrorCode.NOT_FOUND 
        });
      }
      
      if (!user.googleRefreshToken || user.googleRefreshToken.trim() === '') {
        return res.status(400).json({ 
          message: 'Google Calendar not connected', 
          code: ErrorCode.CALENDAR_NOT_CONNECTED 
        });
      }
      
      try {
        // Use the calendar service to get events
        const events = await getCalendarEvents(user, start, end);
        res.json(events);
      } catch (error) {
        console.error('Failed to fetch calendar events:', error);
        
        // Use the centralized error handler
        if (handleGoogleCalendarError(error, res)) {
          // Error was handled by the utility function
          return;
        }
        
        // Handle any other errors
        return res.status(500).json({ 
          message: 'Failed to fetch calendar events',
          error: error instanceof Error ? error.message : String(error),
          code: ErrorCode.SERVER_ERROR
        });
      }
    } catch (error) {
      // This will catch any errors in parameter validation
      console.error('Error in calendar events endpoint:', error);
      res.status(400).json({ 
        message: 'Invalid request parameters', 
        code: ErrorCode.VALIDATION_ERROR 
      });
    }
  });

  // Test endpoint for timezone handling (development only)
  app.post('/api/test/timezone-fix', requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      
      if (!user || !user.googleRefreshToken || user.googleRefreshToken.trim() === '') {
        return res.status(400).json({ 
          message: 'Google Calendar not connected', 
          code: 'CALENDAR_NOT_CONNECTED' 
        });
      }
      
      // Import the test function
      const { testTimezoneHandling } = await import('./test-timezone-fix');
      
      // Get timezone from request or use user's default
      const timezone = req.body.timezone || user.timezone || 'UTC';
      
      // Run the test
      console.log(`Running timezone handling test with timezone: ${timezone}`);
      const testResult = await testTimezoneHandling(user.googleRefreshToken, timezone);
      
      // Return the results
      res.json({
        success: true,
        message: 'Timezone handling test completed',
        results: testResult
      });
    } catch (error) {
      console.error('Error running timezone handling test:', error);
      
      // Check if this is a token expired error
      if (error instanceof TokenExpiredError) {
        return res.status(401).json({
          success: false,
          message: 'Google Calendar token has expired',
          code: 'GOOGLE_TOKEN_EXPIRED'
        });
      }
      
      res.status(500).json({ 
        success: false,
        message: 'Failed to run timezone handling test',
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });
  
  const httpServer = createServer(app);
  
  // No longer need to set up WebSockets - we've moved to a polling-based approach
  
  // Start Slack monitoring service
  const stopMonitoring = startSlackMonitoring();
  
  // System monitoring endpoints
  app.get('/api/system/status', requireAuth, async (req, res) => {
    // Check if the user has configured Slack
    const user = await storage.getUser(req.session.userId!);
    const slackConfigured = !!(user && user.slackUserId);
    
    // Get the webhook health status - a healthy webhook has received events in the past 24 hours
    // This is stored in the slackEvents service
    const webhookMetrics = getWebhookHealthStatus();
    
    // Determine health status
    const webhookStatus = slackConfigured ? 
      (webhookMetrics.events.total > 0 && 
       webhookMetrics.lastActive && 
       (Date.now() - new Date(webhookMetrics.lastActive).getTime()) < 24 * 60 * 60 * 1000 
          ? 'healthy' 
          : 'unhealthy'
      ) : 'unconfigured';
    
    res.json({
      slack_monitoring: getMonitoringStatus(),
      slack_webhook: {
        ...webhookMetrics,
        enabled: true, // The webhooks are always enabled on the server side
        configured: slackConfigured,
        url: `${req.protocol}://${req.get('host')}/slack/events`,
        status: webhookStatus
      },
      app_updates: {
        method: 'polling',
        active: true,
        polling_interval: '30s'
      }
    });
  });
  
  // Manually trigger the Slack task scanning for testing
  app.post('/api/system/slack/scan', requireAuth, async (req, res) => {
    try {
      console.log("Manually triggering task detection from API endpoint...");
      const result = await checkForNewTasksManually();
      console.log("Manual task detection completed with result:", result);
      res.json({
        success: true,
        message: 'Slack task scanning completed successfully',
        result
      });
    } catch (error) {
      console.error("Error during manual task detection:", error);
      res.status(500).json({ 
        success: false,
        message: 'Failed to scan for new tasks',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  // Simple GET endpoint for testing task detection without auth (development only)
  app.get('/api/test/slack/scan', async (req, res) => {
    try {
      console.log("TEST ENDPOINT: Manually triggering task detection...");
      const result = await checkForNewTasksManually();
      console.log("TEST ENDPOINT: Manual task detection completed with result:", result);
      res.json({
        success: true,
        message: 'Test scan completed successfully',
        result
      });
    } catch (error) {
      console.error("TEST ENDPOINT: Error during manual task detection:", error);
      res.status(500).json({ 
        success: false,
        message: 'Failed to scan for new tasks',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  // System maintenance endpoints - admin access only
  app.post('/api/system/slack/reset', requireAuth, async (req, res) => {
    try {
      // Check if user is admin (ideally, you would have a proper role system)
      const user = await storage.getUser(req.session.userId!);
      if (!user || user.id !== 1) { // Simple check for first user as admin
        return res.status(403).json({ message: 'Unauthorized. Admin access required.' });
      }
      
      const resetResult = resetMonitoring();
      res.json({
        success: true,
        message: 'Slack monitoring reset successfully',
        details: resetResult
      });
    } catch (error) {
      console.error('Error resetting Slack monitoring:', error);
      res.status(500).json({ message: 'Failed to reset Slack monitoring' });
    }
  });
  
  app.post('/api/system/slack/check-now', requireAuth, async (req, res) => {
    try {
      // Check if user is admin or has Slack integration
      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      // Allow if user is admin or has Slack integration
      const isAdmin = user.id === 1;
      const hasSlackIntegration = !!user.slackUserId;
      
      if (!isAdmin && !hasSlackIntegration) {
        return res.status(403).json({ 
          message: 'Unauthorized. Admin access or Slack integration required.' 
        });
      }
      
      // Run the manual check
      const checkResult = await checkForNewTasksManually();
      
      res.json({
        success: true,
        message: 'Manual Slack task check completed',
        details: checkResult
      });
    } catch (error) {
      console.error('Error running manual Slack task check:', error);
      res.status(500).json({ 
        message: 'Failed to run manual Slack task check',
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });

app.post('/api/system/slack/clear-cache', requireAuth, async (req, res) => {
    try {
      // Check if user is admin
      const user = await storage.getUser(req.session.userId!);
      if (!user || user.id !== 1) { // Simple check for first user as admin
        return res.status(403).json({ message: 'Unauthorized. Admin access required.' });
      }
      
      const { keepCount } = req.body;
      const keepCountValue = keepCount ? parseInt(keepCount, 10) : 0;
      
      // Clear processed messages
      const clearedMessagesCount = clearProcessedMessages(keepCountValue);
      
      // Reset all tasks display status in the database
      let resetCount = 0;
      if (keepCountValue === 0) {
        resetCount = await storage.resetAllTaskDisplayStatus(req.session.userId!);
        console.log(`Reset display status for ${resetCount} tasks`);
      }
      
      res.json({
        success: true,
        message: `Successfully cleared ${clearedMessagesCount} processed message(s) and reset ${resetCount} task display states`,
        clearedMessages: clearedMessagesCount,
        clearedTasks: resetCount,
        keepCount: keepCountValue
      });
    } catch (error) {
      console.error('Error clearing processed messages:', error);
      res.status(500).json({ message: 'Failed to clear processed messages' });
    }
  });
  
  // TEST ENDPOINT: Force task detection test
  app.post('/api/slack/test-task-detection', requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      
      if (!user || !user.slackUserId) {
        return res.status(400).json({ message: 'Slack integration not configured' });
      }
      
      const { text } = req.body;
      
      if (!text) {
        return res.status(400).json({ message: 'Message text is required' });
      }
      
      console.log(`TEST ENDPOINT: Manually triggering task detection for text: "${text}"`);
      
      // Create a test message object
      const testMessage = {
        ts: `test-${Date.now()}`,
        text,
        user: user.slackUserId,
        channelId: 'test-channel',
        channelName: 'test-channel'
      };
      
      // Run the message through the OpenAI analysis
      const aiAnalysis = await analyzeMessageForTask(testMessage, user.slackUserId);
      
      console.log('OpenAI Analysis Result:', JSON.stringify(aiAnalysis, null, 2));
      
      // Check if it's a task
      if (aiAnalysis.is_task) {
        console.log(`TEST ENDPOINT: Analysis detected a task with confidence ${aiAnalysis.confidence}`);
        
        // Send task detection DM with user token when available
        await sendTaskDetectionDM(user.slackUserId, testMessage, user.slackAccessToken || undefined);
        
        return res.status(200).json({ 
          success: true, 
          is_task: true,
          analysis: aiAnalysis,
          message: 'Task detected and DM sent'
        });
      } else {
        console.log(`TEST ENDPOINT: Analysis did NOT detect a task. Confidence: ${aiAnalysis.confidence}`);
        return res.status(200).json({ 
          success: true, 
          is_task: false,
          analysis: aiAnalysis,
          message: 'Not detected as a task' 
        });
      }
    } catch (error) {
      console.error('Error in test task detection endpoint:', error);
      res.status(500).json({ message: 'Error testing task detection' });
    }
  });

  return httpServer;
}
