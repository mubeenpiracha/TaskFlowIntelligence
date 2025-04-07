import { WebSocketServer } from 'ws';
import { Server } from 'http';
import WebSocket from 'ws';
import { storage } from '../storage';

// Map to track active client connections
const clients: Map<number, WebSocket[]> = new Map();

// Create and initialize the WebSocket server
export function setupWebSocketServer(server: Server) {
  // Create WebSocket server on a specific path to avoid conflicts with Vite's HMR
  const wss = new WebSocketServer({ server, path: '/ws' });
  
  console.log('WebSocket server initialized at /ws');
  
  // Handle new client connections
  wss.on('connection', (ws, req) => {
    console.log('New WebSocket connection');
    
    let userId: number | undefined;
    let authenticated = false;
    
    // Handle client disconnection
    ws.on('close', () => {
      if (userId) {
        console.log(`WebSocket connection closed for user ${userId}`);
        removeClient(userId, ws);
      } else {
        console.log('Unauthenticated WebSocket connection closed');
      }
    });
    
    // Handle incoming messages from client
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // Handle authentication
        if (data.type === 'auth' && data.userId && !authenticated) {
          userId = Number(data.userId);
          
          // Verify the user exists
          const user = await storage.getUser(userId);
          
          if (user) {
            authenticated = true;
            addClient(userId, ws);
            
            // Send a welcome message
            ws.send(JSON.stringify({
              type: 'connection_established',
              message: 'Connected to TaskFlow websocket server',
              userId: userId
            }));
            
            console.log(`WebSocket authenticated for user ${userId}`);
          } else {
            console.warn(`WebSocket auth failed - Invalid user ID: ${userId}`);
            ws.send(JSON.stringify({
              type: 'auth_error',
              message: 'Authentication failed'
            }));
            
            // Close the connection after a short delay
            setTimeout(() => ws.close(1008, 'Authentication failed'), 1000);
          }
        } 
        // Only process other messages if authenticated
        else if (authenticated && userId) {
          handleClientMessage(userId, data, ws);
        }
        // Reject unauthenticated messages
        else if (!authenticated && data.type !== 'auth') {
          console.warn('Unauthenticated WebSocket message rejected');
          ws.send(JSON.stringify({
            type: 'auth_required',
            message: 'Authentication required'
          }));
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });
    
    // Initial message to request authentication
    ws.send(JSON.stringify({
      type: 'auth_required',
      message: 'Please authenticate with userId'
    }));
  });
  
  return wss;
}

// User ID is now sent in the auth message from client, so this function is no longer needed

/**
 * Adds a client connection to the tracking map
 * @param userId - User ID
 * @param ws - WebSocket connection
 */
function addClient(userId: number, ws: WebSocket) {
  if (!clients.has(userId)) {
    clients.set(userId, []);
  }
  
  const userClients = clients.get(userId)!;
  userClients.push(ws);
  
  console.log(`User ${userId} now has ${userClients.length} active WebSocket connections`);
}

/**
 * Removes a client connection from the tracking map
 * @param userId - User ID
 * @param ws - WebSocket connection to remove
 */
function removeClient(userId: number, ws: WebSocket) {
  if (!clients.has(userId)) return;
  
  const userClients = clients.get(userId)!;
  const index = userClients.indexOf(ws);
  
  if (index !== -1) {
    userClients.splice(index, 1);
  }
  
  // If no more connections for this user, remove the entry
  if (userClients.length === 0) {
    clients.delete(userId);
  }
}

/**
 * Handles an incoming message from a client
 * @param userId - User ID
 * @param data - Message data
 * @param ws - WebSocket connection
 */
function handleClientMessage(userId: number, data: any, ws: WebSocket) {
  // Basic message handling - could be expanded based on application needs
  if (data.type === 'ping') {
    // Respond to ping messages
    ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
  }
}

/**
 * Sends a message to all connected clients for a specific user
 * @param userId - User ID to send to
 * @param message - Message object to send
 * @returns Number of clients the message was sent to
 */
export function sendToUser(userId: number, message: any): number {
  // If no clients for this user, return 0
  if (!clients.has(userId)) return 0;
  
  const userClients = clients.get(userId)!;
  const jsonMessage = JSON.stringify(message);
  
  // Send to all active connections for this user
  let sentCount = 0;
  userClients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(jsonMessage);
      sentCount++;
    }
  });
  
  return sentCount;
}

/**
 * Broadcast a notification about a new task detection to the user
 * @param userId - User ID
 * @param task - Task details
 */
export function notifyTaskDetection(userId: number, task: any) {
  return sendToUser(userId, {
    type: 'task_detected',
    task
  });
}

/**
 * Get the number of active clients for a user
 * @param userId - User ID
 * @returns Number of active WebSocket connections
 */
export function getActiveClientCount(userId: number): number {
  if (!clients.has(userId)) return 0;
  
  // Only count clients in OPEN state
  return clients.get(userId)!.filter(
    client => client.readyState === WebSocket.OPEN
  ).length;
}

/**
 * Get the total number of active WebSocket connections
 * @returns Total count
 */
export function getTotalConnectionCount(): number {
  let total = 0;
  clients.forEach(userClients => {
    total += userClients.filter(
      client => client.readyState === WebSocket.OPEN
    ).length;
  });
  return total;
}