import { useEffect, useState, useRef, useCallback } from "react";
import type { ScannerSnapshot } from "./scanner-api";

interface UseScannerWebSocketProps {
  wsUrl: string | null;
  enabled: boolean;
}

interface UseScannerWebSocketResult {
  snapshot: ScannerSnapshot | null;
  connected: boolean;
  lastUpdate: Date | null;
}

export function useScannerWebSocket({
  wsUrl,
  enabled,
}: UseScannerWebSocketProps): UseScannerWebSocketResult {
  const [snapshot, setSnapshot] = useState<ScannerSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);

  const connect = useCallback(() => {
    if (!wsUrl || !enabled) return;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectAttempts.current = 0;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "scanner_update" && msg.data) {
            setSnapshot(msg.data);
            setLastUpdate(new Date());
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (enabled && reconnectAttempts.current < 10) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          reconnectAttempts.current++;
          reconnectTimer.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    } catch {
      // connection failed
    }
  }, [wsUrl, enabled]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { snapshot, connected, lastUpdate };
}
