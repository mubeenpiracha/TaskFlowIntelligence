// Configuration settings for the application

// Base URL for the application
// For local development, use: http://localhost:5000
// For Replit deployment, use your Replit URL, e.g.: https://taskflow.replit.app
export const BASE_URL =
  "https://cf3428df-04d6-468d-af24-1dd4a587b350-00-3tucxtywmyqog.janeway.replit.dev";

// OAuth redirect URLs
export const GOOGLE_LOGIN_REDIRECT_URL = `${BASE_URL}/api/auth/google/login/callback`;
export const GOOGLE_CALENDAR_REDIRECT_URL = `${BASE_URL}/api/auth/google/calendar/callback`;

// Other configuration settings
export const SESSION_SECRET =
  process.env.SESSION_SECRET || "task-flow-session-secret";
