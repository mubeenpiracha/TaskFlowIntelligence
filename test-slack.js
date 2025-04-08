// Script to test the Slack Web API connection
import { WebClient } from '@slack/web-api';

async function testSlack() {
  // Check if we have the Slack Bot Token
  if (!process.env.SLACK_BOT_TOKEN) {
    console.error('Error: SLACK_BOT_TOKEN environment variable is not set');
    return;
  }

  console.log('Testing Slack Web API connection...');
  
  try {
    // Initialize the Slack Web Client
    const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
    
    // Test 1: Get the bot info
    console.log('Test 1: Getting bot info...');
    const botInfo = await slack.auth.test();
    console.log('Connected to Slack as:', botInfo.user);
    console.log('Team:', botInfo.team);
    console.log('Bot ID:', botInfo.user_id);
    console.log('✅ Bot connection successful!');
    
    // Test 2: List channels (public) 
    console.log('\nTest 2: Listing public channels...');
    const channelsResult = await slack.conversations.list({
      exclude_archived: true,
      types: 'public_channel'
    });
    
    if (channelsResult.channels && channelsResult.channels.length > 0) {
      console.log(`Found ${channelsResult.channels.length} public channels:`);
      channelsResult.channels.slice(0, 5).forEach(channel => {
        console.log(`- #${channel.name} (${channel.id})`);
      });
      console.log('✅ Channel listing successful!');
    } else {
      console.log('No public channels found or no access to view them');
    }
    
    // Test 3: Send a test message directly to the 'all-task-scheduler' general channel
    // This channel should have the bot already added
    console.log('\nTest 3: Sending a test message...');
    const generalChannelId = 'C08JZ3WK5CP'; // all-task-scheduler channel
    
    try {
      // Send message to the general channel where the bot should already be invited
      const message = await slack.chat.postMessage({
        channel: generalChannelId,
        text: 'This is a test message from the Task Master app!'
      });
      console.log(`✅ Message sent successfully! Timestamp: ${message.ts}`);
    } catch (msgError) {
      console.error('Error sending message:', msgError.data?.error || msgError.message);
      
      // If that failed, try looking for a channel where the bot is already a member
      console.log('\nLooking for channels where bot is already a member...');
      const botChannels = channelsResult.channels.filter(channel => channel.is_member);
      
      if (botChannels.length > 0) {
        console.log(`Found ${botChannels.length} channels where bot is a member:`);
        botChannels.forEach(channel => {
          console.log(`- #${channel.name} (${channel.id})`);
        });
        
        // Try sending to the first channel where bot is a member
        try {
          const fallbackMessage = await slack.chat.postMessage({
            channel: botChannels[0].id,
            text: 'This is a fallback test message from the Task Master app!'
          });
          console.log(`✅ Fallback message sent successfully to #${botChannels[0].name}! Timestamp: ${fallbackMessage.ts}`);
        } catch (fallbackError) {
          console.error('Error sending fallback message:', fallbackError.data?.error || fallbackError.message);
        }
      } else {
        console.log('No channels found where bot is a member. Cannot send test message.');
      }
    }
    
    console.log('\nAll tests completed successfully! ✨');
    
  } catch (error) {
    console.error('Error connecting to Slack:', error);
    if (error.data && error.data.error) {
      console.error('Slack API Error:', error.data.error);
    }
  }
}

// Run the test
testSlack();