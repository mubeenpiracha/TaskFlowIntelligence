# TaskFlow - AI-Powered Task Management System

## Overview

TaskFlow is an intelligent task management system that automatically detects, schedules, and manages tasks from Slack conversations using AI. It integrates with Google Calendar for smart scheduling and provides real-time updates through WebSocket connections.

## Key Features

### 🤖 AI-Powered Task Detection
- **OpenAI Integration**: Uses GPT-4o to analyze Slack messages for task content
- **Smart Analysis**: Extracts task title, description, urgency, importance, and deadlines
- **Confidence Scoring**: Provides confidence levels for task detection accuracy
- **Context Awareness**: Understands mentions, deadlines, and task semantics

### 📅 Intelligent Scheduling
- **Google Calendar Integration**: Automatically schedules tasks in available time slots
- **Timezone Handling**: Supports multiple timezones with proper conversion
- **Conflict Resolution**: Handles scheduling conflicts with user interaction
- **Working Hours**: Respects user-defined working hours and preferences

### 💬 Slack Integration
- **Real-time Webhooks**: Processes Slack messages as they arrive
- **Multi-workspace Support**: Handles multiple Slack workspaces per user
- **Channel Preferences**: Configurable channel monitoring settings
- **Direct Messaging**: Sends confirmations and notifications via Slack DM

### 🔄 Real-time Updates
- **WebSocket Communication**: Live updates for task status changes
- **Connection Management**: Handles multiple connections per user with limits
- **Heartbeat Monitoring**: Maintains connection health with ping/pong
- **Auto-reconnection**: Graceful handling of connection drops

## Architecture

### Frontend (React + TypeScript)
```
client/src/
├── components/          # Reusable UI components
│   ├── ui/             # shadcn/ui components
│   ├── modals/         # Modal dialogs
│   └── *.tsx           # Feature components
├── pages/              # Application pages
├── hooks/              # Custom React hooks
├── lib/                # Utility libraries
└── App.tsx             # Main application router
```

### Backend (Node.js + Express)
```
server/
├── services/           # Core business logic
│   ├── slack.ts        # Slack API integration
│   ├── google.ts       # Google Calendar API
│   ├── openaiService.ts # AI task analysis
│   ├── scheduler.ts    # Automatic task scheduling
│   └── websocket.ts    # Real-time communication
├── routes.ts           # API endpoints
├── storage.ts          # Data access layer
└── index.ts            # Server entry point
```

### Database Schema
```
shared/schema.ts        # Drizzle ORM schema definitions
├── users              # User accounts and preferences
├── workspaces         # Slack workspace configurations
├── tasks              # Task records and status
└── working_hours      # User availability settings
```

## Core APIs and Functions

### Authentication & OAuth
- **Session Management**: `server/routes.ts` - Session-based authentication
- **Google OAuth**: `server/services/google.ts` - Calendar access tokens
- **Slack OAuth**: `server/services/slackOAuth.ts` - Workspace integration

### Task Management
- **Task Detection**: `server/services/openaiService.ts`
  - `analyzeMessageForTask()` - AI-powered task analysis
- **Task Creation**: `server/services/taskCreation.ts`
  - `createTaskFromMessage()` - Convert messages to tasks
- **Task Scheduling**: `server/services/scheduler.ts`
  - `startScheduler()` - Background task processor
  - `scheduleUnscheduledTasks()` - Find and schedule pending tasks

### Calendar Integration
- **Event Management**: `server/services/calendarService.ts`
  - `createEvent()` - Create calendar events
  - `updateEvent()` - Modify existing events
  - `getCalendarEvents()` - Fetch availability
- **Timezone Handling**: `server/utils/offsetUtils.ts`
  - `convertToUserTimezone()` - Timezone conversions
  - `formatDateWithOffset()` - Date formatting

### Slack Integration
- **Message Processing**: `server/services/slackEvents.ts`
  - `handleSlackEvent()` - Process incoming webhooks
- **Bot Communication**: `server/services/slack.ts`
  - `sendMessage()` - Send Slack messages
  - `sendTaskDetectionDM()` - Task confirmation DMs
- **Channel Management**: `server/services/channelPreferences.ts`
  - Channel monitoring configuration

### Real-time Communication
- **WebSocket Server**: `server/services/websocket.ts`
  - `broadcastToUser()` - Send updates to specific users
  - `handleClientMessage()` - Process client messages

## Development Setup

### Prerequisites
- Node.js 18+ with npm
- PostgreSQL database
- API keys for external services

### Environment Variables
Create a `.env` file with the following variables:

```bash
# Database
DATABASE_URL=postgresql://username:password@localhost:5432/taskflow

# Slack Integration
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_CLIENT_ID=your-client-id
SLACK_CLIENT_SECRET=your-client-secret

# Google Calendar
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# OpenAI
OPENAI_API_KEY=your-openai-api-key

# Security
SESSION_SECRET=your-secure-session-secret-min-32-chars

# Application
BASE_URL=http://localhost:5000
NODE_ENV=development
```

### Installation & Running

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Setup Database**
   ```bash
   npm run db:push
   ```

3. **Start Development Server**
   ```bash
   npm run dev
   ```

4. **Access Application**
   - Frontend: http://localhost:5000
   - API: http://localhost:5000/api

## API Endpoints

### Authentication
- `GET /api/auth/me` - Get current user
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/google/login/url` - Google OAuth URL
- `GET /api/auth/google/login/callback` - Google OAuth callback
- `GET /api/auth/slack/url` - Slack OAuth URL
- `GET /api/auth/slack/callback` - Slack OAuth callback

### Tasks
- `GET /api/tasks` - List user tasks
- `GET /api/tasks/:id` - Get specific task
- `POST /api/tasks` - Create new task
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task
- `POST /api/tasks/:id/complete` - Mark task complete

### Calendar
- `GET /api/calendar/events` - List calendar events
- `POST /api/calendar/events` - Create calendar event
- `PUT /api/calendar/events/:id` - Update calendar event
- `DELETE /api/calendar/events/:id` - Delete calendar event

### Webhooks
- `POST /api/slack/events` - Slack event webhook
- `POST /api/slack/interactive` - Slack interactive components

## Security Features

### Authentication & Authorization
- Session-based authentication with httpOnly cookies
- 24-hour session expiration with automatic cleanup
- PBKDF2 password hashing with 10,000 iterations
- OAuth2 integration for Google and Slack

### API Protection
- Rate limiting: 100 requests per 15 minutes (general)
- Webhook rate limiting: 60 requests per minute
- HMAC-SHA256 signature verification for Slack webhooks
- Input validation using Zod schemas
- Secure error handling without information disclosure

### Infrastructure Security
- HSTS headers for HTTPS enforcement
- X-Frame-Options for clickjacking protection
- Content Security Policy headers
- Secure session configuration

## Data Flow

### Task Creation Workflow
1. **Message Received**: Slack webhook delivers message
2. **AI Analysis**: OpenAI analyzes message for task content
3. **User Confirmation**: Bot sends confirmation DM to user
4. **Task Creation**: User confirms, task saved to database
5. **Scheduling**: Scheduler finds available time slot
6. **Calendar Event**: Event created in Google Calendar
7. **Real-time Update**: WebSocket notifies frontend

### Scheduling Logic
1. **Task Processing**: Scheduler runs every 30 seconds
2. **User Filtering**: Process users with Google Calendar integration
3. **Availability Check**: Fetch calendar events for availability
4. **Slot Selection**: Find optimal time based on:
   - Working hours preferences
   - Existing calendar events
   - Task priority and deadline
   - Estimated duration
5. **Event Creation**: Create calendar event
6. **Status Update**: Mark task as scheduled

## Testing & Debugging

### Built-in Test Pages
- `/timezone-test` - Test timezone handling
- `/task-detection-test` - Test AI task detection
- Access these pages when logged in for debugging

### Logging
- All services include comprehensive logging
- WebSocket connections are tracked and logged
- Scheduler operations are logged with timestamps
- Error handling includes detailed error messages

### Development Tools
- Hot reload with Vite for frontend changes
- TypeScript compilation with tsx for backend
- Drizzle Studio for database inspection
- Built-in rate limiting bypass for development

## Deployment

### Production Build
```bash
npm run build
```

### Environment Requirements
- Node.js 18+ runtime
- PostgreSQL database
- All environment variables configured
- HTTPS endpoint for OAuth callbacks

### Scaling Considerations
- WebSocket connection limits (5 per user)
- Database connection pooling
- Rate limiting for API protection
- Session cleanup for memory management

## Contributing

### Code Style
- TypeScript strict mode enabled
- ESLint configuration for code quality
- Prettier for code formatting
- Type-safe database operations with Drizzle ORM

### Development Guidelines
1. **Frontend**: Use React Query for server state management
2. **Backend**: Keep routes thin, business logic in services
3. **Database**: Use Drizzle migrations, never manual SQL
4. **Testing**: Add tests for new features and bug fixes
5. **Security**: Validate all inputs with Zod schemas

### File Organization
- **Shared Types**: Define in `shared/schema.ts`
- **UI Components**: Use shadcn/ui components when possible
- **Business Logic**: Implement in `server/services/`
- **Database Operations**: Use storage interface abstractions

## Troubleshooting

### Common Issues

1. **Calendar Integration Not Working**
   - Verify Google OAuth credentials
   - Check token expiration and refresh logic
   - Ensure proper timezone configuration

2. **Slack Webhooks Failing**
   - Verify webhook URL configuration
   - Check signing secret for signature verification
   - Ensure rate limiting isn't blocking requests

3. **Task Detection Not Accurate**
   - Verify OpenAI API key is working
   - Check message format and content
   - Review AI prompt configuration

4. **WebSocket Connection Issues**
   - Check connection limits (5 per user)
   - Verify heartbeat/ping-pong mechanism
   - Review client-side reconnection logic

### Support
- Check application logs for detailed error messages
- Use built-in test pages for debugging specific features
- Verify all environment variables are properly configured
- Ensure external API credentials are valid and have proper permissions

## License

MIT License - see LICENSE file for details.