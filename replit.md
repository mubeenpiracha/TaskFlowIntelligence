# TaskFlow - Slack-Integrated Task Management System

## Overview

TaskFlow is a comprehensive task management application that integrates with Slack and Google Calendar to automatically detect tasks from Slack messages and schedule them on users' calendars. The system uses AI-powered task detection via OpenAI's GPT-4o model and provides a web interface for task management.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Build Tool**: Vite
- **UI Components**: Radix UI with Tailwind CSS for styling
- **State Management**: TanStack Query for server state and React hooks for local state
- **Routing**: Wouter for client-side routing
- **Theme**: Professional theme with custom Tailwind configuration

### Backend Architecture
- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Drizzle ORM
- **Session Management**: Express-session with memory store
- **Authentication**: Custom session-based auth with Google OAuth2 integration
- **API Integration**: Slack Web API, Google Calendar API, OpenAI API

### Database Schema
- **Users**: User accounts with Slack/Google integration tokens
- **Tasks**: Task records with scheduling and status information
- **Working Hours**: User-defined working hours for scheduling
- **Workspaces**: Slack workspace configurations

## Key Components

### 1. Task Detection System
- **Slack Webhooks**: Real-time event processing for message analysis
- **AI Analysis**: OpenAI GPT-4o integration for intelligent task detection
- **Confidence Scoring**: Tasks are analyzed with confidence levels before creation
- **User Confirmation**: Interactive Slack messages for task approval/rejection

### 2. Calendar Integration
- **Google Calendar API**: Full calendar event management
- **Timezone Handling**: User timezone support with offset-based calculations
- **Conflict Resolution**: Intelligent scheduling around existing events
- **Working Hours**: Respects user-defined availability windows

### 3. Security Implementation
- **Rate Limiting**: Multiple rate limiting strategies for different endpoint types
- **Slack Signature Verification**: HMAC-SHA256 verification for webhook security
- **Session Security**: Secure cookie configuration with proper expiration
- **Environment Validation**: Required environment variable validation
- **Security Headers**: XSS protection, clickjacking prevention, HTTPS enforcement

### 4. Real-time Communication
- **WebSocket Server**: Real-time task updates and notifications
- **Slack Integration**: Bidirectional communication with Slack workspaces
- **Task Notifications**: Immediate feedback on task detection and scheduling

## Data Flow

### Task Detection Flow
1. Slack message received via webhook
2. Message analyzed by OpenAI for task content
3. If task detected, user receives confirmation request in Slack
4. Upon confirmation, task created in database
5. Automatic scheduling attempted based on user's calendar and working hours
6. Calendar event created if scheduling successful
7. User notified of completion via Slack

### Authentication Flow
1. User can authenticate via username/password or Google OAuth
2. Slack integration requires separate OAuth flow
3. Google Calendar integration requires additional consent for calendar access
4. All tokens stored securely with refresh token rotation

### Calendar Scheduling Flow
1. Unscheduled tasks processed by background scheduler
2. User's calendar fetched to identify available time slots
3. Tasks scheduled based on priority, deadline, and working hours
4. Calendar events created with proper timezone handling
5. Conflicts resolved through user interaction when necessary

## External Dependencies

### Third-Party Services
- **Slack API**: Message monitoring, user interaction, notifications
- **Google Calendar API**: Event creation, calendar access, timezone handling
- **OpenAI API**: GPT-4o model for intelligent task analysis
- **PostgreSQL**: Primary data storage (can be swapped for other databases)

### Key Libraries
- **Drizzle ORM**: Type-safe database operations
- **@slack/web-api**: Slack integration
- **googleapis**: Google API access
- **date-fns**: Date manipulation and formatting
- **zod**: Runtime type validation

## Deployment Strategy

### Environment Configuration
- **Development**: Local development with hot reload via Vite
- **Production**: Bundled application with esbuild
- **Database**: PostgreSQL connection with SSL support in production
- **Secrets**: Environment variables for all sensitive configuration

### Scaling Considerations
- **Rate Limiting**: Protects against abuse and API quota limits
- **Session Storage**: Currently uses memory store (should be replaced with Redis for production scaling)
- **WebSocket Management**: Connection limits and cleanup for resource management
- **Background Processing**: Task scheduling runs on intervals (consider queue system for high volume)

### Security Hardening
- Production-ready security implementation completed
- Webhook signature verification prevents unauthorized access
- Rate limiting protects against DoS attacks
- Secure session configuration with proper cookie settings
- Environment validation ensures required secrets are present

## Changelog

Changelog:
- June 25, 2025. Initial setup

## User Preferences

Preferred communication style: Simple, everyday language.