import 'express-session';

declare module 'express-session' {
  interface SessionData {
    userId: number;
    slackChannelIds?: string[];
  }
}