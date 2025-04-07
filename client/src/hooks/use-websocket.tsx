import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './use-auth';

export interface WebSocketMessage {
  type: string;
  [key: string]: any; // Allow any additional properties
}

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const { user } = useAuth();
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Function to establish WebSocket connection
  const connect = useCallback(() => {
    // Don't connect if the user is not authenticated
    if (!user) {
      return;
    }

    // Close existing connection if any
    if (socketRef.current) {
      socketRef.current.close();
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
      console.log('WebSocket connected');
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
          userId: user.id
        }));
      }
    };
    
    socket.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log('Received WebSocket message:', message);
        setLastMessage(message);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    socket.onclose = (event) => {
      console.log('WebSocket disconnected, code:', event.code, 'reason:', event.reason);
      setIsConnected(false);
      
      // Attempt to reconnect unless it was a normal closure
      if (event.code !== 1000) {
        console.log('Scheduling WebSocket reconnect...');
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('Attempting to reconnect WebSocket...');
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
      console.log('Cleaning up WebSocket connection');
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (socketRef.current) {
        socketRef.current.close();
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