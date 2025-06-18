import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';

/**
 * Verify Slack webhook signature to ensure requests are from Slack
 * Based on Slack's security documentation
 */
export function verifySlackSignature(req: Request): boolean {
  const slackSignature = req.headers['x-slack-signature'] as string;
  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!slackSignature || !timestamp || !signingSecret) {
    console.warn('[SLACK_SECURITY] Missing signature, timestamp, or signing secret');
    return false;
  }

  // Check timestamp to prevent replay attacks (5 minutes tolerance)
  const currentTime = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);
  
  if (Math.abs(currentTime - requestTime) > 300) {
    console.warn('[SLACK_SECURITY] Request timestamp too old');
    return false;
  }

  // Create signature basestring
  const basestring = `v0:${timestamp}:${req.body}`;
  
  // Generate expected signature
  const expectedSignature = `v0=${createHmac('sha256', signingSecret)
    .update(basestring, 'utf8')
    .digest('hex')}`;

  // Use timing-safe comparison
  try {
    const signatureBuffer = Buffer.from(slackSignature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    
    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }
    
    return timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch (error) {
    console.error('[SLACK_SECURITY] Error comparing signatures:', error);
    return false;
  }
}

/**
 * Middleware to verify Slack webhook signatures
 */
export function requireSlackSignature(req: Request, res: any, next: any): void {
  // Skip verification in development if signing secret is not set
  if (process.env.NODE_ENV !== 'production' && !process.env.SLACK_SIGNING_SECRET) {
    console.warn('[SLACK_SECURITY] Skipping signature verification in development');
    return next();
  }

  if (!verifySlackSignature(req)) {
    console.error('[SLACK_SECURITY] Invalid Slack signature');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
}