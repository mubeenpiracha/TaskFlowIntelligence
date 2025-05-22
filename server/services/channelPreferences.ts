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
      console.log('[SLACK] No channel preferences found for user:', userId);
      return [];
    }

    console.log('[SLACK] Retrieved channel preferences for user', userId, ':', user.slackChannelPreferences);
    
    try {
      // Try to parse the JSON stored in slackChannelPreferences
      const parsedData = JSON.parse(user.slackChannelPreferences);
      
      // Check different possible formats of the stored preferences
      if (Array.isArray(parsedData)) {
        // Direct array of channel IDs
        console.log('[SLACK] Channel preferences stored as direct array');
        return parsedData;
      } else if (parsedData.channelIds && Array.isArray(parsedData.channelIds)) {
        // Object with channelIds property that is an array
        console.log('[SLACK] Channel preferences stored in channelIds property');
        return parsedData.channelIds;
      } else if (typeof parsedData === 'object') {
        // Object where the keys might be channel IDs
        const possibleChannelIds = Object.keys(parsedData).filter(key => 
          key.startsWith('C') && key.length > 8
        );
        
        if (possibleChannelIds.length > 0) {
          console.log('[SLACK] Channel preferences extracted from object keys');
          return possibleChannelIds;
        }
      }
      
      // If we got here, we couldn't identify a valid format
      console.log('[SLACK] Could not identify valid channel preferences format:', parsedData);
      return [];
    } catch (parseError) {
      // If parsing fails, try to handle it as a direct string or comma-separated list
      console.error('[SLACK] Error parsing channel preferences JSON:', parseError);
      
      // Check if it's a comma-separated string of channel IDs
      if (user.slackChannelPreferences.includes(',')) {
        const channelIds = user.slackChannelPreferences.split(',')
          .map(id => id.trim())
          .filter(id => id.length > 0);
        
        console.log('[SLACK] Extracted channel IDs from comma-separated string:', channelIds);
        return channelIds;
      }
      
      // If it's a single channel ID without any JSON or separators
      if (user.slackChannelPreferences.startsWith('C') && user.slackChannelPreferences.length > 8) {
        console.log('[SLACK] Using single channel ID from preferences:', user.slackChannelPreferences);
        return [user.slackChannelPreferences];
      }
      
      // If all else fails, return empty array
      return [];
    }
  } catch (error) {
    console.error('[SLACK] Error getting channel preferences:', error);
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