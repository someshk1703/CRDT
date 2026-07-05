import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppMessage } from '@crdt/shared';

export type WsStatus = 'connecting' | 'open' | 'closed' | 'error';

interface UseWebSocketOptions {
  /** Called with the parsed JSON payload of every incoming message. */
  onMessage?: (data: AppMessage | Record<string, unknown>) => void;
  /** Base delay in ms before the first reconnect attempt. Default: 1000. */
  reconnectBaseMs?: number;
  /** Maximum reconnect delay in ms (exponential backoff cap). Default: 30000. */
  reconnectMaxMs?: number;
  /**
   * Number of consecutive failed reconnect attempts before status transitions
   * to `error`. The hook keeps retrying — status clears back to `open` on
   * success. Default: 5. (NFR-005)
   */
  errorAfterAttempts?: number;
}

interface UseWebSocketReturn {
  /** Send a JSON-serialisable message. No-ops if the socket is not open. */
  send: (msg: object) => void;
  status: WsStatus;
}

/**
 * Manages a WebSocket connection with automatic exponential-backoff reconnection.
 *
 * Constitution requirement (Principle III): reconnect with backoff is mandatory
 * from Week 1 — a dropped connection with no reconnect is the first thing that
 * looks broken in a demo.
 *
 * Backoff schedule (default): 1s → 2s → 4s → 8s → 16s → 30s (capped)
 */
export function useWebSocket(
  url: string | null,
  options: UseWebSocketOptions = {},
): UseWebSocketReturn {
  const {
    reconnectBaseMs = 1_000,
    reconnectMaxMs = 30_000,
    errorAfterAttempts = 5,
  } = options;

  const wsRef = useRef<WebSocket | null>(null);
  const isMounted = useRef(true);
  const retryCount = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep onMessage stable across renders without re-running the effect
  const onMessageRef = useRef(options.onMessage);
  onMessageRef.current = options.onMessage;

  const [status, setStatus] = useState<WsStatus>('closed');

  const connect = useCallback(() => {
    if (!url || !isMounted.current) return;

    setStatus('connecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!isMounted.current) {
        ws.close();
        return;
      }
      retryCount.current = 0;
      setStatus('open');
      console.log('[ws] connected to', url);
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as AppMessage | Record<string, unknown>;
        onMessageRef.current?.(data);
      } catch {
        console.warn('[ws] received malformed JSON — ignored');
      }
    };

    ws.onclose = () => {
      if (!isMounted.current) return;
      setStatus('closed');
      wsRef.current = null;

      const delay = Math.min(
        reconnectBaseMs * 2 ** retryCount.current,
        reconnectMaxMs,
      );
      retryCount.current++;

      // NFR-005: surface error state after threshold so UI can warn the user.
      // The hook keeps retrying — status clears to 'open' on next successful connect.
      if (retryCount.current >= errorAfterAttempts) {
        setStatus('error');
      }

      console.log(`[ws] closed — retrying in ${delay}ms (attempt ${retryCount.current})`);
      retryTimer.current = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // onclose fires right after onerror; backoff reconnect is handled there.
      console.error('[ws] connection error');
    };
  }, [url, reconnectBaseMs, reconnectMaxMs]);

  useEffect(() => {
    isMounted.current = true;
    connect();

    return () => {
      isMounted.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [connect]);

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { send, status };
}
