import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { startScheduler } from './services/scheduler';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Log all requests for debugging
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  // Log the request immediately
  console.log(`[REQUEST] ${req.method} ${path}`);
  
  if (req.method === 'POST' && (path.includes('/slack/interactions') || path.includes('/api/slack/interactions'))) {
    console.log(`[SLACK INTERACTION] Body keys: ${Object.keys(req.body).join(', ')}`);
    console.log(`[SLACK INTERACTION] Content-Type: ${req.headers['content-type']}`);
  }

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    // Log all responses with status code 400 or higher
    if (res.statusCode >= 400) {
      console.error(`[ERROR] ${req.method} ${path} responded with ${res.statusCode} in ${duration}ms`);
    }
    
    if (path.startsWith("/api") || path.startsWith("/slack")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on port 5000
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = 5000;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
    
    // TEMP: Scheduler disabled during migration
    // Start the automatic task scheduler
    // startScheduler();
  });
})();
