# TaskFlow - Slack-Integrated Task Management System

## Overview

TaskFlow is a comprehensive task management application that integrates with Slack and Google Calendar to automatically detect, manage, and schedule tasks. The system uses AI-powered task detection through OpenAI to analyze Slack messages and create actionable tasks with intelligent scheduling capabilities.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Build Tool**: Vite for development and production builds
- **Styling**: Tailwind CSS with shadcn/ui component library
- **State Management**: TanStack Query (React Query) for server state
- **Routing**: Wouter for lightweight client-side routing
- **UI Components**: Radix UI primitives with custom styling

### Backend Architecture
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js for HTTP server
- **Database ORM**: Drizzle ORM for type-safe database operations
- **Authentication**: Session-based auth with express-session
- **Real-time Communication**: WebSocket server for live task updates
- **API Integrations**: Slack Web API, Google Calendar API, OpenAI API

### Data Storage Solutions
- **Primary Database**: PostgreSQL with Drizzle ORM
- **Connection**: Node Postgres with connection pooling
- **Migrations**: Drizzle Kit for database schema management
- **Session Storage**: PostgreSQL-backed session store using connect-pg-simple

## Key Components

### Core Services
1. **Task Detection Service**: Uses OpenAI to analyze Slack messages for task content
2. **Scheduler Service**: Automatically schedules tasks in Google Calendar based on availability
3. **Slack Integration**: Webhook-based event handling for real-time message processing
4. **Calendar Service**: Manages Google Calendar events and synchronization
5. **Notification System**: Real-time notifications via WebSocket and Slack messages

### Security Features
- HMAC-SHA256 signature verification for Slack webhooks
- Rate limiting for API endpoints (100 req/15min general, 60 req/min webhooks)
- Secure session configuration with httpOnly cookies
- Environment variable validation and secure defaults
- Security headers (HSTS, X-Frame-Options, etc.)

### AI-Powered Features
- **Task Detection**: Analyzes message content, urgency, importance, and deadlines
- **Smart Scheduling**: Finds optimal time slots based on calendar availability
- **Conflict Resolution**: Handles scheduling conflicts with user interaction

## Data Flow

### Task Creation Workflow
1. Slack message received via webhook
2. Message analyzed by OpenAI for task content
3. If task detected, user receives confirmation prompt
4. Upon confirmation, task created in database
5. Scheduler automatically finds available time slot
6. Calendar event created in Google Calendar
7. Real-time updates sent via WebSocket

### Authentication Flow
- Session-based authentication with 24-hour expiration
- Google OAuth2 for calendar integration
- Slack OAuth2 for workspace integration
- Multi-workspace support with workspace-specific configurations

### Data Synchronization
- Real-time webhook processing for Slack events
- Periodic calendar synchronization for availability checking
- WebSocket notifications for immediate UI updates
- Automatic retry mechanisms for failed operations

## External Dependencies

### Required Integrations
- **Slack API**: Bot token and signing secret for webhook verification
- **Google Calendar API**: OAuth2 credentials for calendar access
- **OpenAI API**: GPT-4 for intelligent task detection and analysis
- **PostgreSQL**: Database for persistent storage

### Environment Variables
- `DATABASE_URL`: PostgreSQL connection string
- `SLACK_BOT_TOKEN`: Slack bot token (xoxb-)
- `SLACK_SIGNING_SECRET`: For webhook signature verification
- `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`: OAuth2 credentials
- `OPENAI_API_KEY`: OpenAI API access
- `SESSION_SECRET`: Session encryption key (required in production)
- `BASE_URL`: Application base URL for OAuth redirects

## Deployment Strategy

### Development Setup
- Uses Replit's Node.js environment with PostgreSQL module
- Hot reload with Vite for frontend development
- Express server with TypeScript compilation via tsx
- Automatic dependency management with npm

### Production Build
- Frontend: Vite build to `dist/public`
- Backend: esbuild bundle to `dist/index.js`
- Database: Drizzle migrations applied before startup
- Environment validation on application start

### Scaling Considerations
- Replit autoscale deployment target
- WebSocket connection management with heartbeat
- Rate limiting to prevent abuse
- Session cleanup for memory management

## Changelog
- June 26, 2025. Initial setup

## User Preferences

Preferred communication style: Simple, everyday language.