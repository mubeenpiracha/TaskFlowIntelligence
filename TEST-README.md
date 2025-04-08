# Task Master Test Scripts

This directory contains several test scripts to verify the functionality of key components of the Task Master application.

## Slack Webhook Tests

### Test Script: `test-slack-webhook.js`

This script tests the Slack Events API webhook endpoint which receives events from Slack.

**Usage:**
```bash
# Test URL verification challenge
node test-slack-webhook.js verification

# Test message event
node test-slack-webhook.js event
```

**What it tests:**
- The app's ability to respond to Slack's URL verification challenges
- The app's ability to receive and process message events

## Slack API Tests

### Test Script: `test-slack.js`

This script tests the application's connection to the Slack Web API.

**Usage:**
```bash
node test-slack.js
```

**What it tests:**
- Authentication with Slack API
- Listing available channels
- Sending messages to channels

## OpenAI Tests

### Test Script: `test-openai.js`

This script tests the connection to OpenAI's API and verifies the task detection capabilities.

**Usage:**
```bash
node test-openai.js
```

**What it tests:**
- Basic API connectivity
- Task detection with sample messages
- Extraction of task metadata like deadlines, urgency, etc.

## Environment Requirements

All test scripts require appropriate environment variables to be set:

- `test-slack-webhook.js`: No environment variables required
- `test-slack.js`: Requires `SLACK_BOT_TOKEN`
- `test-openai.js`: Requires `OPENAI_API_KEY`

## Troubleshooting

If tests fail, check the following:

1. **Webhook Tests**: Ensure the webhook URL is correct and that the server is running
2. **Slack API Tests**: Verify the bot token has the required permissions
3. **OpenAI Tests**: Check the API key and ensure rate limits haven't been exceeded
