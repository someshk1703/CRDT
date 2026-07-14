import { useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { basicSetup, EditorView } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { useWebSocket } from '../hooks/useWebSocket';
import { useCRDT } from '../hooks/useCRDT';

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
  const editorMountedRef = useRef(false);

  // Stable userId for this session (one UUID per tab)
  const userIdRef = useRef(crypto.randomUUID());

  const wsUrl = roomId ? `${WS_BASE}/room/${roomId}` : null;

  const { extensions: crdtExtensions, applyRemoteOp, setView, sendRef } = useCRDT(
    userIdRef.current,
    roomId ?? '',
  );

  const { send, status } = useWebSocket(wsUrl, { onMessage: applyRemoteOp });

  // Keep useCRDT's sendRef in sync with the real send from useWebSocket
  sendRef.current = send;

  // ── Mount CodeMirror ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!editorContainerRef.current || editorMountedRef.current) return;
    editorMountedRef.current = true;

    const view = new EditorView({
      extensions: [
        basicSetup,
        javascript(),
        // Week 2: CRDT extensions handle local→op broadcast and remote op display.
        ...crdtExtensions,
      ],
      parent: editorContainerRef.current,
    });

    setView(view);

    return () => {
      view.destroy();
      editorMountedRef.current = false;
    };
    // crdtExtensions and setView are stable refs — safe to omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    </div>
  );
}
