import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './use-auth';

export interface WebSocketMessage {
  type: string;
  [key: string]: any; // Allow any additional properties
}

// Store a global connection counter to avoid duplicate connections
let activeConnectionCount = 0;
const MAX_CONNECTIONS_PER_CLIENT = 1;

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const { user } = useAuth();
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectionIdRef = useRef<string>(`ws-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);

  // Function to establish WebSocket connection
  const connect = useCallback(() => {
    // Don't connect if the user is not authenticated
    if (!user) {
      return;
    }

    // Check if we already have too many active connections
    if (activeConnectionCount >= MAX_CONNECTIONS_PER_CLIENT) {
      console.log(`Skipping WebSocket connection - already have ${activeConnectionCount} active connections`);
      return;
    }

    // Close existing connection if any
    if (socketRef.current) {
      try {
        socketRef.current.close();
        activeConnectionCount = Math.max(0, activeConnectionCount - 1);
      } catch (e) {
        console.error('Error closing existing WebSocket:', e);
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    console.log(`Creating new WebSocket connection (ID: ${connectionIdRef.current})`);
    const socket = new WebSocket(wsUrl);
    activeConnectionCount++;
    
    socket.onopen = () => {
      console.log(`WebSocket connected (ID: ${connectionIdRef.current})`);
      setIsConnected(true);
      
      // Clear any reconnection timeout
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      // Send initial authentication message
      if (user) {
        socket.send(JSON.stringify({
          type: 'auth',
          userId: user.id,
          connectionId: connectionIdRef.current
        }));
      }
    };
    
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        // Special handling for ping messages - respond immediately with pong
        if (message.type === 'ping') {
          socket.send(JSON.stringify({
            type: 'pong',
            timestamp: Date.now(),
            connectionId: connectionIdRef.current
          }));
          return; // Don't update last message for pings
        }
        
        console.log('Received WebSocket message:', message);
        setLastMessage(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    socket.onclose = (event) => {
      console.log(`WebSocket disconnected (ID: ${connectionIdRef.current}), code: ${event.code}, reason: ${event.reason}`);
      setIsConnected(false);
      
      // Update our connection counter
      activeConnectionCount = Math.max(0, activeConnectionCount - 1);
      console.log(`Active WebSocket connections after close: ${activeConnectionCount}`);
      
      // Attempt to reconnect unless it was a normal closure
      if (event.code !== 1000) {
        console.log('Scheduling WebSocket reconnect...');
        reconnectTimeoutRef.current = setTimeout(() => {
          // Generate a new connection ID for the reconnection attempt
          connectionIdRef.current = `ws-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
          console.log(`Attempting to reconnect WebSocket with new ID: ${connectionIdRef.current}`);
          connect();
        }, 3000);
      }
    };
    
    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    socketRef.current = socket;
    
    // Cleanup function for unmounting
    return () => {
      console.log(`Cleaning up WebSocket connection (ID: ${connectionIdRef.current})`);
      
      // Clear any pending reconnect timeouts
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      // Close the socket if it exists
      if (socketRef.current) {
        try {
          socketRef.current.close(1000, "Component unmounted");
          // Update our counter
          activeConnectionCount = Math.max(0, activeConnectionCount - 1);
          console.log(`Active WebSocket connections after cleanup: ${activeConnectionCount}`);
          socketRef.current = null;
        } catch (e) {
          console.error('Error closing WebSocket during cleanup:', e);
        }
      }
    };
  }, [user]);

  // Method to send a message through the WebSocket
  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    } else {
      console.warn('Cannot send message, WebSocket not connected');
    }
  }, []);

  // Connect when the component mounts or when the user changes
  useEffect(() => {
    const cleanup = connect();
    return cleanup;
  }, [connect, user]);

  return {
    isConnected,
    lastMessage,
    sendMessage
  };
}