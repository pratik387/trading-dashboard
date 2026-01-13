/**
 * React hook for WebSocket connection to trading instances.
 *
 * Manages WebSocket lifecycle, subscriptions, and automatic reconnection.
 * Converts HTTP instance URL to WebSocket URL (port + 1).
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { tradingWS } from "./websocket";
import type { InstanceStatus, InstancePosition, ClosedTrade } from "./api";

interface UseInstanceWebSocketProps {
  /** HTTP URL of the instance (e.g., "http://localhost:8080") */
  instanceUrl: string | null;
  /** Whether WebSocket connection should be active */
  enabled: boolean;
  /** Callback for status updates */
  onStatus?: (data: { state: string }) => void;
  /** Callback for position updates (full list) */
  onPositions?: (positions: InstancePosition[]) => void;
  /** Callback for new closed trade */
  onClosedTrade?: (trade: ClosedTrade) => void;
  /** Callback for LTP batch updates */
  onLTPBatch?: (prices: Record<string, { price: number; timestamp: string }>) => void;
}

interface UseInstanceWebSocketResult {
  /** Whether WebSocket is currently connected */
  connected: boolean;
  /** Connection state: "disconnected" | "connecting" | "connected" */
  connectionState: "disconnected" | "connecting" | "connected";
  /** Last connection error, if any */
  error: Error | null;
  /** Manually trigger reconnection */
  reconnect: () => void;
}

/**
 * Convert HTTP URL to WebSocket URL.
 * Assumes WS server runs on HTTP port + 1.
 *
 * @example
 * httpToWsUrl("http://localhost:8080") -> "ws://localhost:8081"
 * httpToWsUrl("https://example.com:8080") -> "wss://example.com:8081"
 */
function httpToWsUrl(httpUrl: string): string {
  const url = new URL(httpUrl);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const port = parseInt(url.port || "8080", 10) + 1;
  return `${protocol}//${url.hostname}:${port}`;
}

export function useInstanceWebSocket({
  instanceUrl,
  enabled,
  onStatus,
  onPositions,
  onClosedTrade,
  onLTPBatch,
}: UseInstanceWebSocketProps): UseInstanceWebSocketResult {
  const [connected, setConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<
    "disconnected" | "connecting" | "connected"
  >("disconnected");
  const [error, setError] = useState<Error | null>(null);

  // Store callbacks in refs to avoid re-subscribing on every render
  const onStatusRef = useRef(onStatus);
  const onPositionsRef = useRef(onPositions);
  const onClosedTradeRef = useRef(onClosedTrade);
  const onLTPBatchRef = useRef(onLTPBatch);

  // Update refs when callbacks change
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    onPositionsRef.current = onPositions;
  }, [onPositions]);

  useEffect(() => {
    onClosedTradeRef.current = onClosedTrade;
  }, [onClosedTrade]);

  useEffect(() => {
    onLTPBatchRef.current = onLTPBatch;
  }, [onLTPBatch]);

  const reconnect = useCallback(() => {
    if (instanceUrl && enabled) {
      const wsUrl = httpToWsUrl(instanceUrl);
      setConnectionState("connecting");
      setError(null);

      tradingWS
        .connect(wsUrl)
        .then(() => {
          setConnected(true);
          setConnectionState("connected");
          setError(null);
        })
        .catch((err) => {
          setConnected(false);
          setConnectionState("disconnected");
          setError(err instanceof Error ? err : new Error(String(err)));
        });
    }
  }, [instanceUrl, enabled]);

  useEffect(() => {
    // Disconnect if disabled or no URL
    if (!instanceUrl || !enabled) {
      tradingWS.disconnect();
      setConnected(false);
      setConnectionState("disconnected");
      return;
    }

    const wsUrl = httpToWsUrl(instanceUrl);
    setConnectionState("connecting");
    setError(null);

    // Connect to WebSocket
    tradingWS
      .connect(wsUrl)
      .then(() => {
        setConnected(true);
        setConnectionState("connected");
        setError(null);
      })
      .catch((err) => {
        setConnected(false);
        setConnectionState("disconnected");
        setError(err instanceof Error ? err : new Error(String(err)));
      });

    // Subscribe to events using stable refs
    const unsubscribers: (() => void)[] = [];

    // Status updates
    unsubscribers.push(
      tradingWS.subscribe("status", (data) => {
        if (onStatusRef.current) {
          onStatusRef.current(data as { state: string });
        }
      })
    );

    // Position updates (full list)
    unsubscribers.push(
      tradingWS.subscribe("positions", (data) => {
        if (onPositionsRef.current) {
          const payload = data as { positions: InstancePosition[] };
          onPositionsRef.current(payload.positions);
        }
      })
    );

    // Closed trade notifications
    unsubscribers.push(
      tradingWS.subscribe("closed_trade", (data) => {
        if (onClosedTradeRef.current) {
          onClosedTradeRef.current(data as ClosedTrade);
        }
      })
    );

    // LTP batch updates
    unsubscribers.push(
      tradingWS.subscribe("ltp_batch", (data) => {
        if (onLTPBatchRef.current) {
          const payload = data as {
            prices: Record<string, { price: number; timestamp: string }>;
          };
          onLTPBatchRef.current(payload.prices);
        }
      })
    );

    // Cleanup on unmount or dependency change
    return () => {
      unsubscribers.forEach((unsub) => unsub());
      tradingWS.disconnect();
      setConnected(false);
      setConnectionState("disconnected");
    };
  }, [instanceUrl, enabled]);

  return {
    connected,
    connectionState,
    error,
    reconnect,
  };
}
