// Script to test the Slack webhook endpoint
import https from 'https';

// Replit URL
const replitUrl = 'cf3428df-04d6-468d-af24-1dd4a587b350-00-3tucxtywmyqog.janeway.replit.dev';

// Test data - simulate a Slack message event
const testEvent = {
  token: 'test-token',
  team_id: 'T12345',
  api_app_id: 'A12345',
  event: {
    type: 'message',
    channel: 'C12345',
    user: 'U12345',
    text: 'This is a test task for tomorrow',
    ts: `test-${Date.now()}`,
  },
  type: 'event_callback',
  event_id: `Ev${Date.now()}`,
  event_time: Math.floor(Date.now() / 1000),
};

// URL verification challenge data
const urlVerification = {
  type: 'url_verification',
  challenge: 'test-challenge',
};

console.log('Sending test event to webhook endpoint...');

// Which test to run? Can be 'event' or 'verification'
const testType = process.argv[2] || 'event';
const testData = testType === 'verification' ? urlVerification : testEvent;

// POST request options
const options = {
  hostname: replitUrl,
  port: 443,
  path: '/slack/events',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Slack-Request-Timestamp': Math.floor(Date.now() / 1000).toString(),
    'X-Slack-Signature': 'v0=test-signature',
  }
};

// Send the request
const req = https.request(options, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response body:', data);
    console.log('Test complete');
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

// Write data to request body
req.write(JSON.stringify(testData));
req.end();