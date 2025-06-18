// Configuration settings for the application

// Validate required environment variables
function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

function getOptionalEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

// Base URL for the application
export const BASE_URL = getOptionalEnv('BASE_URL', 'http://localhost:5000');

// OAuth redirect URLs
export const GOOGLE_LOGIN_REDIRECT_URL = `${BASE_URL}/api/auth/google/login/callback`;
export const GOOGLE_CALENDAR_REDIRECT_URL = `${BASE_URL}/api/auth/google/calendar/callback`;
export const SLACK_OAUTH_REDIRECT_URL = `${BASE_URL}/api/auth/slack/callback`;

// Session configuration
export const SESSION_SECRET = process.env.NODE_ENV === 'production' 
  ? getRequiredEnv('SESSION_SECRET')
  : getOptionalEnv('SESSION_SECRET', 'dev-session-secret-change-in-production');

// Validate configuration on startup
export function validateConfig(): void {
  console.log('[CONFIG] Validating configuration...');
  
  // Required in all environments
  getRequiredEnv('DATABASE_URL');
  
  // Required in production
  if (process.env.NODE_ENV === 'production') {
    getRequiredEnv('SESSION_SECRET');
    getRequiredEnv('BASE_URL');
    getRequiredEnv('GOOGLE_CLIENT_ID');
    getRequiredEnv('GOOGLE_CLIENT_SECRET');
    getRequiredEnv('SLACK_BOT_TOKEN');
    getRequiredEnv('SLACK_SIGNING_SECRET');
    getRequiredEnv('OPENAI_API_KEY');
  }
  
  console.log('[CONFIG] Configuration validation passed');
}
