import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { basicSetup, EditorView } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { useWebSocket } from '../hooks/useWebSocket';

/**
 * Reads the WS server URL from the Vite env variable, falling back to localhost
 * for local development. In production, set VITE_WS_URL in your deployment env.
 */
const WS_BASE = import.meta.env.VITE_WS_URL ?? 'ws://localhost:3001';

const STATUS_COLORS: Record<string, string> = {
  open: '#a6e3a1',
  connecting: '#f9e2af',
  closed: '#f38ba8',
  error: '#f38ba8',
};

export function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  /** Week 1 broadcast log — replaced by actual document sync in Week 2. */
  const [broadcastLog, setBroadcastLog] = useState<string[]>([]);

  const wsUrl = roomId ? `${WS_BASE}/room/${roomId}` : null;

  const onMessage = useCallback((data: unknown) => {
    const line = typeof data === 'object'
      ? JSON.stringify(data)
      : String(data);
    setBroadcastLog((prev) => [...prev.slice(-99), line]);
  }, []);

  const { send, status } = useWebSocket(wsUrl, { onMessage });

  // ── Mount CodeMirror ────────────────────────────────────────────────────────
  // Important: send is a stable ref from useCallback, safe to include in deps.

  useEffect(() => {
    if (!editorContainerRef.current || viewRef.current) return;

    const view = new EditorView({
      extensions: [
        basicSetup,
        javascript(),
        /**
         * Week 1: on every local document change, broadcast the raw text delta
         * over WebSocket so the other tab can see it in the broadcast log.
         *
         * Week 2 replaces this listener with a proper CRDT op generator that
         * intercepts Transactions and produces CRDTChar inserts/deletes.
         */
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          update.transactions.forEach((tr) => {
            tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
              send({
                type: 'op',
                payload: {
                  from: fromA,
                  to: toA,
                  insert: inserted.toString(),
                },
              });
            });
          });
        }),
      ],
      parent: editorContainerRef.current,
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [send]);

  // ── Guard: no roomId ────────────────────────────────────────────────────────

  if (!roomId) {
    return (
      <div style={{ padding: '2rem', color: '#f38ba8', background: '#1e1e2e', minHeight: '100vh' }}>
        No room ID in URL. Go back to <a href="/" style={{ color: '#89b4fa' }}>home</a>.
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* ── Header ── */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.5rem 1rem',
        background: '#181825',
        borderBottom: '1px solid #313244',
        flexShrink: 0,
      }}>
        <span style={{ fontWeight: 700, color: '#cdd6f4' }}>CRDT Editor</span>
        <span style={{ fontSize: '0.8rem', color: '#6c7086' }}>
          Room: <span style={{ color: '#89b4fa' }}>{roomId}</span>
        </span>

        <button
          style={{
            marginLeft: '0.5rem',
            fontSize: '0.75rem',
            padding: '2px 8px',
            borderRadius: '6px',
            border: '1px solid #45475a',
            background: 'transparent',
            color: '#a6adc8',
            cursor: 'pointer',
          }}
          onClick={() => {
            void navigator.clipboard.writeText(window.location.href);
          }}
          title="Copy share link"
        >
          Copy link
        </button>

        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {status === 'error' && (
            <span style={{ fontSize: '0.72rem', color: '#f38ba8' }}>
              having trouble connecting…
            </span>
          )}
          <span style={{
            fontSize: '0.72rem',
            padding: '2px 10px',
            borderRadius: '999px',
            background: STATUS_COLORS[status] ?? '#45475a',
            color: '#1e1e2e',
            fontWeight: 600,
          }}>
            {status}
          </span>
        </span>
      </div>

      {/* ── CodeMirror editor ── */}
      <div
        ref={editorContainerRef}
        style={{ flex: 1, overflow: 'auto', background: '#1e1e2e' }}
      />

      {/* ── Week 1 broadcast log ── */}
      <div style={{
        height: '180px',
        overflowY: 'auto',
        background: '#11111b',
        borderTop: '1px solid #313244',
        padding: '0.5rem 1rem',
        fontFamily: 'monospace',
        fontSize: '0.72rem',
        color: '#a6adc8',
        flexShrink: 0,
      }}>
        <div style={{ color: '#45475a', marginBottom: '4px', userSelect: 'none' }}>
          ▸ Broadcast log (Week 1 debug — removed in Week 2):
        </div>
        {broadcastLog.length === 0 ? (
          <div style={{ color: '#313244' }}>
            No broadcasts yet — open another tab at this URL and type something.
          </div>
        ) : (
          broadcastLog.map((line, i) => (
            <div key={i} style={{ lineHeight: '1.6' }}>{line}</div>
          ))
        )}
      </div>
    </div>
  );
}
