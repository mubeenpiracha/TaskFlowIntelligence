/**
 * This module is responsible for sending calendar-related notifications to users via Slack
 */

import { slack } from './slack';
import { BASE_URL } from '../config';

/**
 * Sends a notification to the user when their Google Calendar token has expired
 * @param slackUserId Slack user ID to send the notification to
 * @param task The task that was being scheduled when the token error occurred
 * @returns Promise with the message timestamp or undefined on failure
 */
export async function sendCalendarTokenExpiredNotification(
  slackUserId: string,
  task: { id: number; title: string }
): Promise<string | undefined> {
  try {
    console.log(`[NOTIFICATIONS] Sending calendar token expired notification to Slack user ${slackUserId}`);
    
    // Generate reconnect URL for the settings page
    const reconnectUrl = `${BASE_URL}/settings?reconnectCalendar=true`;
    
    const blocks = [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:warning: *Calendar Connection Issue*\n\nI couldn't add your task "${task.title}" to your calendar because your Google Calendar authorization has expired.`
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "To make sure your tasks get scheduled properly, please reconnect your Google Calendar."
        }
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Reconnect Calendar",
              emoji: true
            },
            style: "primary",
            url: reconnectUrl
          }
        ]
      }
    ];
    
    // Send the notification
    const result = await slack.chat.postMessage({
      channel: slackUserId,
      text: "Google Calendar reconnection needed",
      blocks
    });
    
    return result.ts;
  } catch (error) {
    console.error('[NOTIFICATIONS] Error sending calendar token expired notification:', error);
    return undefined;
  }
}