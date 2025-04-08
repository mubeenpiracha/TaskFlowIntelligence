import { WebClient } from '@slack/web-api';
console.log('Checking if Slack bot token works...');
const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
async function testSlack() {
  try {
    const result = await slack.auth.test();
    console.log('Slack bot token works! Authenticated as:', result.user);
    console.log('Team:', result.team);
    console.log('Bot ID:', result.user_id);
  } catch (error) {
    console.error('Slack bot token test failed:', error.message);
    console.error('Error details:', error);
  }
}
testSlack().catch(console.error);
