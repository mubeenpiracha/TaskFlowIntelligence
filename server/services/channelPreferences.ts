import { db } from '../db';
import { users } from '@shared/schema';
import { eq } from 'drizzle-orm';

/**
 * Structure for storing channel preferences in the User schema
 */
interface ChannelPreferences {
  channelIds: string[];
}

/**
 * Gets a user's Slack channel preferences for task detection
 * @param userId - The user ID
 * @returns An array of channel IDs the user has selected
 */
export async function getChannelPreferences(userId: number): Promise<string[]> {
  try {
    // Retrieve the user record
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (!user || !user.slackChannelPreferences) {
      return [];
    }
    
    // Parse the JSON stored in slackChannelPreferences
    const preferences: ChannelPreferences = JSON.parse(user.slackChannelPreferences);
    return preferences.channelIds || [];
  } catch (error) {
    console.error('Error getting channel preferences:', error);
    return [];
  }
}

/**
 * Saves a user's Slack channel preferences for task detection
 * @param userId - The user ID
 * @param channelIds - Array of channel IDs to monitor for tasks
 * @returns The updated array of channel IDs
 */
export async function saveChannelPreferences(
  userId: number,
  channelIds: string[]
): Promise<string[]> {
  try {
    // Create the preferences object
    const preferences: ChannelPreferences = {
      channelIds
    };
    
    // Update the user record with the new preferences
    await db
      .update(users)
      .set({ slackChannelPreferences: JSON.stringify(preferences) })
      .where(eq(users.id, userId));
    
    return channelIds;
  } catch (error) {
    console.error('Error saving channel preferences:', error);
    throw error;
  }
}