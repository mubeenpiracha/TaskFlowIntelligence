// Stub implementation to replace the WebSocket functionality
// This is a dummy hook since we're removing websocket usage

export interface WebSocketMessage {
  type: string;
  [key: string]: any; // Allow any additional properties
}

export function useWebSocket() {
  // Returning fixed values since we're no longer using WebSockets
  // This allows components using this hook to still work without changes
  return {
    isConnected: false,
    lastMessage: null,
    sendMessage: (message: WebSocketMessage) => {
      console.log('WebSocket is disabled. Message not sent:', message);
    }
  };
}