import { WebSocketServer } from 'ws';
import { Server } from 'http';
import WebSocket from 'ws';
import { storage } from '../storage';

// Map to track active client connections
const clients: Map<number, WebSocket[]> = new Map();

// Constants for WebSocket connection management
const MAX_CONNECTIONS_PER_USER = 5;
const MAX_TOTAL_CONNECTIONS = 100;
const PING_INTERVAL = 30000; // 30 seconds
const PING_TIMEOUT = 10000; // 10 seconds to respond to ping

// Create and initialize the WebSocket server
export function setupWebSocketServer(server: Server) {
  // Create WebSocket server on a specific path to avoid conflicts with Vite's HMR
  const wss = new WebSocketServer({ server, path: '/ws' });
  
  console.log('WebSocket server initialized at /ws');
  
  // Setup a heartbeat interval to detect dead connections
  setInterval(() => {
    console.log(`[WebSocket] Performing heartbeat check on ${wss.clients.size} connections`);
    
    wss.clients.forEach((ws: WebSocket & { isAlive?: boolean, lastPing?: number, connectionId?: string }) => {
      if (ws.isAlive === false) {
        console.log(`[WebSocket] Terminating inactive connection ${ws.connectionId || 'unknown'}`);
        return ws.terminate();
      }
      
      ws.isAlive = false;
      ws.lastPing = Date.now();
      
      try {
        ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
      } catch (e) {
        // If we can't send a ping, the connection is dead
        console.log(`[WebSocket] Error sending ping, terminating connection: ${e.message}`);
        ws.terminate();
      }
    });
    
    // Log connection stats
    const userCounts: Record<string, number> = {};
    clients.forEach((userClients, userId) => {
      userCounts[userId] = userClients.filter(client => 
        (client as WebSocket & { isAlive?: boolean }).isAlive !== false
      ).length;
    });
    
    console.log(`[WebSocket] Active connections by user: ${JSON.stringify(userCounts)}`);
  }, PING_INTERVAL);
  
  // Handle new client connections
  wss.on('connection', (ws: WebSocket & { isAlive?: boolean, lastPing?: number, connectionId?: string }, req) => {
    // Initialize connection state
    ws.isAlive = true;
    ws.lastPing = Date.now();
    
    // Check total connection limit
    if (wss.clients.size > MAX_TOTAL_CONNECTIONS) {
      console.log(`[WebSocket] Connection rejected - exceeded maximum total connections (${MAX_TOTAL_CONNECTIONS})`);
      ws.close(1013, 'Maximum connections exceeded');
      return;
    }
    
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
    
    // Handle pong messages (keep-alive)
    ws.on('pong', () => {
      ws.isAlive = true;
    });
    
    // Handle incoming messages from client
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // Respond to ping messages with pong
        if (data.type === 'ping') {
          ws.isAlive = true;
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          return;
        }
        
        // Handle pong messages (response to our pings)
        if (data.type === 'pong') {
          ws.isAlive = true;
          return;
        }
        
        // Handle authentication
        if (data.type === 'auth' && data.userId && !authenticated) {
          userId = Number(data.userId);
          
          // Store connection ID for tracking
          if (data.connectionId) {
            ws.connectionId = data.connectionId;
          }
          
          // Verify the user exists
          const user = await storage.getUser(userId);
          
          // Enforce per-user connection limit
          const existingUserConnections = clients.get(userId) || [];
          if (existingUserConnections.length >= MAX_CONNECTIONS_PER_USER) {
            console.log(`[WebSocket] Connection rejected for user ${userId} - exceeded maximum connections per user (${MAX_CONNECTIONS_PER_USER})`);
            
            // Close the oldest connection for this user to make room
            const oldestConnection = existingUserConnections[0];
            try {
              oldestConnection.close(1000, 'Connection replaced by newer connection');
              console.log(`[WebSocket] Closed oldest connection for user ${userId} to make room for new connection`);
            } catch (e) {
              console.error(`[WebSocket] Error closing oldest connection: ${e.message}`);
            }
          }
          
          if (user) {
            authenticated = true;
            addClient(userId, ws);
            
            // Send a welcome message
            ws.send(JSON.stringify({
              type: 'connection_established',
              message: 'Connected to TaskFlow websocket server',
              userId: userId,
              connectionId: ws.connectionId
            }));
            
            console.log(`WebSocket authenticated for user ${userId} (Connection ID: ${ws.connectionId || 'unknown'})`);
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
function addClient(userId: number, ws: WebSocket & { isAlive?: boolean, connectionId?: string }) {
  if (!clients.has(userId)) {
    clients.set(userId, []);
  }
  
  // Ensure the connection has the isAlive property set
  ws.isAlive = true;
  
  const userClients = clients.get(userId)!;
  
  // Clean up any stale connections (not OPEN or not alive)
  const activeClients = userClients.filter(client => {
    const isActive = client.readyState === WebSocket.OPEN && 
                     (client as WebSocket & { isAlive?: boolean }).isAlive !== false;
    return isActive;
  });
  
  // Replace the original array with only active clients
  clients.set(userId, activeClients);
  
  // Then add the new connection
  activeClients.push(ws);
  
  console.log(`User ${userId} now has ${activeClients.length} active WebSocket connections`);
}

/**
 * Removes a client connection from the tracking map
 * @param userId - User ID
 * @param ws - WebSocket connection to remove
 */
function removeClient(userId: number, ws: WebSocket & { connectionId?: string }) {
  if (!clients.has(userId)) return;
  
  const userClients = clients.get(userId)!;
  
  // First check if we have a connection ID to use for a more precise match
  if (ws.connectionId) {
    // Find by connection ID (more reliable)
    const filteredClients = userClients.filter(client => {
      return (client as WebSocket & { connectionId?: string }).connectionId !== ws.connectionId;
    });
    
    // If we removed any, update the list
    if (filteredClients.length < userClients.length) {
      clients.set(userId, filteredClients);
      console.log(`Removed WebSocket connection ${ws.connectionId} for user ${userId}`);
    }
  } else {
    // Fall back to reference equality
    const index = userClients.indexOf(ws);
    
    if (index !== -1) {
      userClients.splice(index, 1);
      console.log(`Removed WebSocket connection at index ${index} for user ${userId}`);
    }
  }
  
  // If no more connections for this user, remove the entry
  if (userClients.length === 0) {
    clients.delete(userId);
    console.log(`User ${userId} has no more active WebSocket connections, removing from clients map`);
  } else {
    console.log(`User ${userId} now has ${userClients.length} active WebSocket connections`);
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
  
  // Keep track of which clients are still active
  const stillActive: WebSocket[] = [];
  
  // Send to all active connections for this user
  let sentCount = 0;
  userClients.forEach(client => {
    // Check if the client is still alive
    const clientWithState = client as WebSocket & { isAlive?: boolean };
    
    // Only send to clients that are OPEN and haven't been marked as dead
    if (client.readyState === WebSocket.OPEN && clientWithState.isAlive !== false) {
      try {
        client.send(jsonMessage);
        sentCount++;
        stillActive.push(client);
      } catch (e) {
        console.log(`Error sending message to client: ${e.message}`);
        // Don't add to stillActive if we couldn't send the message
      }
    } else if (client.readyState === WebSocket.CLOSING || client.readyState === WebSocket.CLOSED) {
      // This connection is already closing or closed, don't include it
      console.log(`Skipping ${client.readyState === WebSocket.CLOSING ? 'closing' : 'closed'} connection`);
    } else if (clientWithState.isAlive === false) {
      console.log(`Skipping connection marked as not alive`);
    } else {
      // Connection in an unknown state - add it to still active to be safe
      stillActive.push(client);
    }
  });
  
  // Update the clients map with only the active connections
  if (stillActive.length < userClients.length) {
    console.log(`Pruned ${userClients.length - stillActive.length} stale WebSocket connections for user ${userId}`);
    clients.set(userId, stillActive);
    
    // If no more active connections, remove the entry
    if (stillActive.length === 0) {
      clients.delete(userId);
      console.log(`No more active connections for user ${userId}, removing from clients map`);
    }
  }
  
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
  
  // Only count clients in OPEN state and marked as alive
  return clients.get(userId)!.filter(client => {
    const typedClient = client as WebSocket & { isAlive?: boolean };
    return client.readyState === WebSocket.OPEN && typedClient.isAlive !== false;
  }).length;
}

/**
 * Get the total number of active WebSocket connections
 * @returns Total count
 */
export function getTotalConnectionCount(): number {
  let total = 0;
  clients.forEach(userClients => {
    total += userClients.filter(client => {
      const typedClient = client as WebSocket & { isAlive?: boolean };
      return client.readyState === WebSocket.OPEN && typedClient.isAlive !== false;
    }).length;
  });
  return total;
}