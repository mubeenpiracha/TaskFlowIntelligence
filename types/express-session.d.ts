import 'express-session';

declare module 'express-session' {
  // This is needed to properly define the session data types
  interface Session {
    userId: number;
    slackChannelIds?: string[];
  }
}