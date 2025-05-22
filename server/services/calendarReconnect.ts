/**
 * This module handles sending notifications to users when their Google Calendar integration
 * needs to be reconnected due to token expiration or revocation.
 */

import { slack } from './slack';
import { BASE_URL } from '../config';
import { storage } from '../storage';
import { User } from '@shared/schema';

/**
 * Sends a notification to a user in Slack when their Google Calendar token has expired
 * Includes a button to reconnect their calendar
 * 
 * @param user The user with the expired token
 * @param taskInfo Information about the task that was being scheduled
 * @returns Promise resolving to the sent message timestamp
 */
export async function sendCalendarReconnectNotification(
  user: User,
  taskInfo: { id: number; title: string }
): Promise<string | undefined> {
  try {
    if (!user.slackUserId) {
      console.warn('Cannot send calendar reconnect notification: user has no Slack ID');
      return undefined;
    }

    console.log(`Sending calendar reconnect notification to user ${user.id} (Slack: ${user.slackUserId})`);
    
    // Generate a reconnect URL for the app
    const reconnectUrl = `${BASE_URL}/settings?reconnectCalendar=true`;
    
    // Create notification message with a button to reconnect
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:warning: *Google Calendar Connection Issue*\n\nI couldn't add this task to your calendar because your Google Calendar authorization has expired.`
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Your task has been created, but to enable calendar scheduling, please reconnect your Google Calendar.`
        }
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Reconnect Google Calendar",
              emoji: true
            },
            style: "primary",
            url: reconnectUrl
          }
        ]
      }
    ];
    
    const message = {
      channel: user.slackUserId,
      text: "Google Calendar reconnection needed",
      blocks
    };
    
    // Send the message
    const result = await slack.chat.postMessage(message);
    return result.ts;
  } catch (error) {
    console.error("Error sending calendar reconnect notification:", error);
    return undefined;
  }
}

/**
 * Handles a Google Calendar token expiration error
 * Marks the user's Google Calendar as disconnected and sends a notification
 * 
 * @param userId The ID of the user whose token expired
 * @param taskInfo Information about the task that was being scheduled
 * @returns True if the notification was sent successfully
 */
export async function handleCalendarTokenExpiration(
  userId: number, 
  taskInfo: { id: number; title: string }
): Promise<boolean> {
  try {
    console.log(`Handling calendar token expiration for user ${userId}`);
    
    // Get the user
    const user = await storage.getUser(userId);
    if (!user) {
      console.error(`Cannot handle calendar token expiration: user ${userId} not found`);
      return false;
    }
    
    // Mark the Google Calendar integration as disconnected
    await storage.disconnectUserGoogleCalendar(userId);
    console.log(`Marked Google Calendar as disconnected for user ${userId}`);
    
    // Send notification to reconnect
    const messageTs = await sendCalendarReconnectNotification(user, taskInfo);
    
    return !!messageTs;
  } catch (error) {
    console.error('Error handling calendar token expiration:', error);
    return false;
  }
}