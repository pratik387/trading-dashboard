/**
 * WebSocket client for real-time trading dashboard updates.
 *
 * Manages connection lifecycle, message handling, and automatic reconnection.
 * Uses native browser WebSocket API.
 */

type MessageHandler = (data: unknown) => void;

interface WebSocketMessage {
  type: string;
  data: unknown;
}

class TradingWebSocket {
  private ws: WebSocket | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Base delay in ms
  private currentUrl: string | null = null;
  private shouldReconnect = true;

  /**
   * Connect to WebSocket server.
   * @param url WebSocket URL (ws:// or wss://)
   */
  connect(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Clean up existing connection
      if (this.ws) {
        this.ws.onclose = null; // Prevent reconnect loop
        this.ws.close();
      }

      this.currentUrl = url;
      this.shouldReconnect = true;

      try {
        this.ws = new WebSocket(url);
      } catch (error) {
        reject(error);
        return;
      }

      this.ws.onopen = () => {
        console.log(`[WS] Connected to ${url}`);
        this.reconnectAttempts = 0;
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);
          const handlers = this.handlers.get(message.type);
          if (handlers) {
            handlers.forEach((handler) => {
              try {
                handler(message.data);
              } catch (e) {
                console.error(`[WS] Handler error for ${message.type}:`, e);
              }
            });
          }
        } catch (e) {
          console.error("[WS] Failed to parse message:", e);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[WS] Disconnected (code: ${event.code})`);
        if (this.shouldReconnect && this.currentUrl) {
          this.attemptReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error("[WS] Connection error:", error);
        // Don't reject here - onclose will be called next
        // Only reject if connection never opened
        if (this.ws?.readyState === WebSocket.CONNECTING) {
          reject(new Error("WebSocket connection failed"));
        }
      };
    });
  }

  /**
   * Subscribe to a message type.
   * @param eventType Message type to subscribe to
   * @param handler Callback function for messages of this type
   * @returns Unsubscribe function
   */
  subscribe(eventType: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  /**
   * Attempt to reconnect with exponential backoff.
   */
  private attemptReconnect() {
    if (
      this.reconnectAttempts >= this.maxReconnectAttempts ||
      !this.currentUrl
    ) {
      console.log("[WS] Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(
      `[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
    );

    setTimeout(() => {
      if (this.shouldReconnect && this.currentUrl) {
        this.connect(this.currentUrl).catch((e) => {
          console.error("[WS] Reconnect failed:", e);
        });
      }
    }, delay);
  }

  /**
   * Disconnect from WebSocket server.
   */
  disconnect() {
    this.shouldReconnect = false;
    this.currentUrl = null;
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }
    console.log("[WS] Disconnected (manual)");
  }

  /**
   * Check if WebSocket is currently connected.
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * Get current connection state.
   */
  getState(): "connecting" | "connected" | "disconnected" {
    if (!this.ws) return "disconnected";
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return "connecting";
      case WebSocket.OPEN:
        return "connected";
      default:
        return "disconnected";
    }
  }

  /**
   * Clear all handlers (useful when unmounting).
   */
  clearHandlers() {
    this.handlers.clear();
  }
}

// Singleton instance for the application
export const tradingWS = new TradingWebSocket();

// Export types for use in hooks
export type { MessageHandler, WebSocketMessage };
