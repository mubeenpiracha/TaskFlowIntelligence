import { Request, Response, NextFunction } from 'express';

interface RateLimitStore {
  [key: string]: {
    count: number;
    resetTime: number;
  };
}

class RateLimiter {
  private store: RateLimitStore = {};
  private windowMs: number;
  private maxRequests: number;

  constructor(windowMs: number = 15 * 60 * 1000, maxRequests: number = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    
    // Clean up expired entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  private cleanup(): void {
    const now = Date.now();
    Object.keys(this.store).forEach(key => {
      if (this.store[key].resetTime < now) {
        delete this.store[key];
      }
    });
  }

  private getKey(req: Request): string {
    // Use forwarded IP if available (for reverse proxies), otherwise use connection IP
    const ip = req.headers['x-forwarded-for'] as string || 
               req.headers['x-real-ip'] as string ||
               req.connection.remoteAddress ||
               req.socket.remoteAddress ||
               'unknown';
    
    return Array.isArray(ip) ? ip[0] : ip.split(',')[0].trim();
  }

  public middleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const key = this.getKey(req);
      const now = Date.now();
      
      if (!this.store[key] || this.store[key].resetTime < now) {
        // Initialize or reset the counter
        this.store[key] = {
          count: 1,
          resetTime: now + this.windowMs
        };
        return next();
      }
      
      this.store[key].count++;
      
      if (this.store[key].count > this.maxRequests) {
        // Rate limit exceeded
        const resetTime = Math.ceil((this.store[key].resetTime - now) / 1000);
        
        res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${resetTime} seconds.`,
          retryAfter: resetTime
        });
        return;
      }
      
      next();
    };
  }
}

// Create different rate limiters for different endpoints
export const generalRateLimit = new RateLimiter(15 * 60 * 1000, 100); // 100 requests per 15 minutes
export const slackWebhookRateLimit = new RateLimiter(1 * 60 * 1000, 60); // 60 requests per minute for Slack webhooks
export const authRateLimit = new RateLimiter(15 * 60 * 1000, 20); // 20 auth attempts per 15 minutes