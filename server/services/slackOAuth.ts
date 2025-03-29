import { WebClient } from '@slack/web-api';
import { SLACK_OAUTH_REDIRECT_URL } from '../config';

// Check if Slack API credentials are set
if (!process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET) {
  console.warn("SLACK_CLIENT_ID or SLACK_CLIENT_SECRET environment variables are not set - Slack OAuth will not work");
}

// For OAuth flow, we don't need the bot token initially
const slackWebClient = new WebClient();

// Scopes needed for the application - user level permissions
const SCOPES = [
  'channels:read',
  'groups:read',
  'channels:history',
  'groups:history',
  'users:read',
  'chat:write',
  'im:history',   // For direct messages
  'mpim:history', // For group direct messages
  'im:read',      // For listing direct messages
  'mpim:read'     // For listing group direct messages
];

/**
 * Generates a URL for Slack OAuth authentication
 * @param state Optional state parameter for security validation
 * @returns Authorization URL to redirect the user to
 */
export function getSlackAuthUrl(state?: string): string {
  const clientId = process.env.SLACK_CLIENT_ID;
  
  if (!clientId) {
    throw new Error('SLACK_CLIENT_ID environment variable is not set');
  }
  
  const params = new URLSearchParams({
    client_id: clientId,
    scope: SCOPES.join(','),
    redirect_uri: SLACK_OAUTH_REDIRECT_URL,
    user_scope: SCOPES.join(',')  // Add user-level scopes as well to get user token
  });
  
  if (state) {
    params.append('state', state);
  }
  
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

/**
 * Exchanges an auth code for tokens and user information
 * @param code Authorization code from OAuth redirect
 * @returns Object containing access token, user ID, and workspace info
 */
export async function exchangeCodeForToken(code: string): Promise<{
  accessToken: string;
  userId: string;
  teamId: string;
  teamName: string;
}> {
  if (!process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET) {
    throw new Error('Slack client credentials are not configured');
  }
  
  try {
    // Exchange the code for access tokens
    const response = await slackWebClient.oauth.v2.access({
      client_id: process.env.SLACK_CLIENT_ID,
      client_secret: process.env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: SLACK_OAUTH_REDIRECT_URL
    });
    
    console.log('Slack OAuth response:', JSON.stringify({
      ok: response.ok,
      has_authed_user: !!response.authed_user,
      has_user_token: !!response.authed_user?.access_token,
      has_bot_token: !!response.access_token,
      has_team: !!response.team,
      scopes: response.scope,
      user_scopes: response.authed_user?.scope
    }, null, 2));
    
    if (!response.ok || !response.authed_user?.id || !response.team?.id) {
      throw new Error('Invalid response from Slack OAuth');
    }
    
    // We MUST have a user token (xoxp-) for this application to work properly
    if (!response.authed_user?.access_token) {
      throw new Error('User token not provided in Slack OAuth response. This app requires user-level permissions.');
    }
    
    // Use the user token, not the bot token
    const accessToken = response.authed_user.access_token;
    
    // Return the tokens and user information
    return {
      accessToken: accessToken,
      userId: response.authed_user.id,
      teamId: response.team.id,
      teamName: response.team.name || response.team.id
    };
  } catch (error) {
    console.error('Error exchanging code for token:', error);
    throw error;
  }
}

/**
 * Gets information about the authenticated user
 * @param accessToken User's access token
 * @returns User information from Slack
 */
export async function getUserInfo(accessToken: string) {
  const client = new WebClient(accessToken);
  
  try {
    // The users.identity method requires a token but no other parameters
    // We need to provide the token explicitly as per Slack API requirements
    const response = await client.users.identity({
      token: accessToken
    } as any); // Using 'as any' to bypass the TypeScript compiler check
    return response;
  } catch (error) {
    console.error('Error getting Slack user info:', error);
    throw error;
  }
}