import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import { storage } from "./storage";
import { z } from "zod";
import { insertTaskSchema, insertUserSchema, insertWorkingHoursSchema } from "@shared/schema";
import { detectTasks, sendMessage, listUserChannels, type SlackChannel, type SlackMessage } from "./services/slack";
import { 
  getCalendarAuthUrl, 
  getLoginAuthUrl,
  getTokens, 
  getUserProfile,
  createCalendarEvent, 
  updateCalendarEvent, 
  deleteCalendarEvent, 
  listCalendarEvents 
} from "./services/google";
import { 
  getSlackAuthUrl,
  exchangeCodeForToken
} from "./services/slackOAuth";
import { GOOGLE_LOGIN_REDIRECT_URL, GOOGLE_CALENDAR_REDIRECT_URL, SLACK_OAUTH_REDIRECT_URL } from './config';
import { getChannelPreferences, saveChannelPreferences } from './services/channelPreferences';
import { createTaskFromSlackMessage, sendTaskConfirmation } from './services/taskCreation';

// Create a store for sessions
import createMemoryStore from 'memorystore';
const MemoryStore = createMemoryStore(session);

export async function registerRoutes(app: Express): Promise<Server> {
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
      const userData = insertUserSchema.parse(req.body);
      const existingUser = await storage.getUserByUsername(userData.username);
      
      if (existingUser) {
        return res.status(400).json({ message: 'Username already exists' });
      }
      
      const user = await storage.createUser(userData);
      
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
      
      if (!user || user.password !== password) {
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
          
          user = await storage.createUser({
            username: email,
            email,
            password: randomPassword,
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

  app.get('/api/auth/slack/callback', async (req, res) => {
    try {
      const { code } = z.object({
        code: z.string()
      }).parse(req.query);
      
      if (!req.session.userId) {
        return res.redirect('/#/login?error=not_authenticated');
      }
      
      const { accessToken, userId, teamId, teamName } = await exchangeCodeForToken(code);
      
      // Store the Slack user ID, access token, and workspace in the user record
      await storage.updateUserSlackInfo(req.session.userId, userId, teamName, accessToken);
      
      // Create default empty channel preferences
      await saveChannelPreferences(req.session.userId, []);
      
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
        // Use the user's token if available, otherwise fall back to bot token
        const channels = await listUserChannels(user.slackAccessToken || undefined);
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
      
      const tasks = await detectTasks(channelIds, user.slackUserId, user.slackAccessToken || undefined);
      res.json(tasks);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to detect tasks from Slack' });
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
      
      // Always send a confirmation message as a DM to the user
      await sendTaskConfirmation(
        task, 
        message.channelId || '', 
        user.slackAccessToken || undefined,
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
          
          const event = await createCalendarEvent(user.googleRefreshToken, {
            summary: task.title,
            description: task.description,
            start: {
              dateTime: startTime.toISOString(),
              timeZone: 'UTC'
            },
            end: {
              dateTime: endTime.toISOString(),
              timeZone: 'UTC'
            }
          });
          
          // Update task with Google Calendar event ID
          await storage.updateTask(task.id, {
            googleEventId: event.id
          });
        } catch (error) {
          console.error('Failed to create Google Calendar event:', error);
          // Handle token expired cases
          if (error.message && (
            error.message.includes('invalid_grant') || 
            error.message.includes('unauthorized_client') || 
            error.message.includes('invalid_token')
          )) {
            console.warn('Google token appears to be invalid or expired');
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
            
            eventUpdate.start = {
              dateTime: startTime.toISOString(),
              timeZone: 'UTC'
            };
            
            eventUpdate.end = {
              dateTime: endTime.toISOString(),
              timeZone: 'UTC'
            };
          }
          
          if (Object.keys(eventUpdate).length > 0) {
            await updateCalendarEvent(user.googleRefreshToken, updatedTask.googleEventId, eventUpdate);
          }
        } catch (error) {
          console.error('Failed to update Google Calendar event:', error);
          // Handle token expired cases
          if (error.message && (
            error.message.includes('invalid_grant') || 
            error.message.includes('unauthorized_client') || 
            error.message.includes('invalid_token')
          )) {
            console.warn('Google token appears to be invalid or expired');
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
            // Handle token expired cases
            if (error.message && (
              error.message.includes('invalid_grant') || 
              error.message.includes('unauthorized_client') || 
              error.message.includes('invalid_token')
            )) {
              console.warn('Google token appears to be invalid or expired');
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
      const { start, end } = z.object({
        start: z.string(),
        end: z.string()
      }).parse(req.query);
      
      const user = await storage.getUser(req.session.userId!);
      
      if (!user || !user.googleRefreshToken || user.googleRefreshToken.trim() === '') {
        return res.status(400).json({ 
          message: 'Google Calendar not connected', 
          code: 'CALENDAR_NOT_CONNECTED' 
        });
      }
      
      try {
        const events = await listCalendarEvents(user.googleRefreshToken, start, end);
        res.json(events);
      } catch (error) {
        console.error('Failed to fetch calendar events:', error);
        
        // Handle token expired cases
        if (error.message && (
          error.message.includes('invalid_grant') || 
          error.message.includes('unauthorized_client') || 
          error.message.includes('invalid_token')
        )) {
          return res.status(401).json({ 
            message: 'Google Calendar authorization expired. Please reconnect your calendar.', 
            code: 'CALENDAR_AUTH_EXPIRED' 
          });
        }
        
        return res.status(500).json({ message: 'Failed to fetch calendar events' });
      }
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: 'Failed to fetch calendar events' });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
