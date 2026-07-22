import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { basicSetup, EditorView } from 'codemirror';
import { Compartment } from '@codemirror/state';
import { useWebSocket } from '../hooks/useWebSocket';
import { useCRDT } from '../hooks/useCRDT';
import { usePresence } from '../hooks/usePresence';
import { useSession } from '../hooks/useSession';
import { getRoom, renameRoom, type RoomInfo } from '../hooks/useRooms';
import { getLanguageExtension } from '../extensions/languageSwitcher';
import { Toolbar } from '../components/Toolbar';

const WS_BASE = (import.meta.env.VITE_WS_URL as string | undefined) ?? 'ws://localhost:3001';

export function Room() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const { session, loading: authLoading } = useSession();
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const editorMountedRef = useRef(false);
  const viewRef = useRef<EditorView | null>(null);

  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [roomNotFound, setRoomNotFound] = useState(false);
  const [language, setLanguage] = useState('javascript');
  const languageCompartment = useRef(new Compartment()).current;

  // WS URL includes auth token
  const wsUrl = roomId && session
    ? `${WS_BASE}/room/${roomId}?token=${session.access_token}`
    : null;

  // ── useCRDT ───────────────────────────────────────────────────────────────

  const {
    extensions: crdtExtensions,
    applyRemoteOp,
    setView: setCrdtView,
    sendRef,
    sendLanguageChange,
  } = useCRDT(session?.user.id ?? 'anon', roomId ?? '', {
    onRemoteChange: (from, removed, inserted) => {
      reconcileCursors(from, removed, inserted);
    },
    onLanguageChange: (lang) => {
      setLanguage(lang);
      if (viewRef.current) {
        viewRef.current.dispatch({
          effects: languageCompartment.reconfigure(getLanguageExtension(lang)),
        });
      }
    },
  });

  // ── usePresence ───────────────────────────────────────────────────────────

  const sendFnRef = useRef<(msg: object) => void>(() => {});

  const {
    handleMessage: handlePresenceMessage,
    sendPresence,
    setView: setPresenceView,
    extensions: presenceExtensions,
    reconcileCursors,
    connectedUsers,
  } = usePresence({
    userId: session?.user.id ?? 'anon',
    roomId: roomId ?? '',
    send: (msg) => sendFnRef.current(msg),
  });

  const handleMessage = useCallback(
    (msg: Parameters<typeof applyRemoteOp>[0]) => {
      applyRemoteOp(msg);
      handlePresenceMessage(msg);
      // room-meta: update room name
      const type = (msg as Record<string, unknown>)['type'];
      if (type === 'room-meta') {
        const name = (msg as Record<string, unknown>)['name'] as string;
        if (name) setRoomInfo((prev) => prev ? { ...prev, name } : prev);
      }
    },
    [applyRemoteOp, handlePresenceMessage],
  );

  const { send, status } = useWebSocket(wsUrl, { onMessage: handleMessage });
  sendRef.current = send;
  sendFnRef.current = send;

  // Close WS when session is cleared (sign-out) — M1
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    if (!session) {
      wsRef.current?.close();
    }
  }, [session]);

  // ── Load room metadata ────────────────────────────────────────────────────

  useEffect(() => {
    if (!roomId || !session) return;
    getRoom(roomId).then((info) => {
      if (!info) { setRoomNotFound(true); return; }
      setRoomInfo(info);
      setLanguage(info.language);
    }).catch(() => setRoomNotFound(true));
  }, [roomId, session]);

  // ── Cursor selection listener ─────────────────────────────────────────────

  const sendPresenceRef = useRef(sendPresence);
  sendPresenceRef.current = sendPresence;

  const selectionListenerExtension = useRef(
    EditorView.updateListener.of((update) => {
      if (update.selectionSet) {
        const { from, to } = update.state.selection.main;
        sendPresenceRef.current({ from, to });
      }
    }),
  ).current;

  // ── Mount CodeMirror ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!editorContainerRef.current || editorMountedRef.current) return;
    editorMountedRef.current = true;

    const view = new EditorView({
      extensions: [
        basicSetup,
        languageCompartment.of(getLanguageExtension(language)),
        ...crdtExtensions,
        presenceExtensions,
        selectionListenerExtension,
      ],
      parent: editorContainerRef.current,
    });

    viewRef.current = view;
    setCrdtView(view);
    setPresenceView(view);

    return () => {
      view.destroy();
      viewRef.current = null;
      editorMountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update language compartment when language state changes after mount
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: languageCompartment.reconfigure(getLanguageExtension(language)),
      });
    }
  }, [language, languageCompartment]);

  // ── Auth guard ────────────────────────────────────────────────────────────

  if (authLoading) {
    return <div style={{ padding: '2rem', color: '#cdd6f4', background: '#1e1e2e', minHeight: '100vh' }}>Loading…</div>;
  }

  if (!session) {
    navigate('/');
    return null;
  }

  if (!roomId) {
    return <div style={{ padding: '2rem', color: '#f38ba8', background: '#1e1e2e', minHeight: '100vh' }}>
      No room ID in URL. <a href="/" style={{ color: '#89b4fa' }}>Go home</a>.
    </div>;
  }

  if (roomNotFound) {
    return <div style={{ padding: '2rem', color: '#f38ba8', background: '#1e1e2e', minHeight: '100vh' }}>
      Room not found. <a href="/" style={{ color: '#89b4fa' }}>Go home</a>.
    </div>;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1e1e2e' }}>
      <Toolbar
        roomName={roomInfo?.name ?? roomId}
        roomSlug={roomId}
        language={language}
        onLanguageChange={(lang) => {
          setLanguage(lang);
          sendLanguageChange(lang);
        }}
        onRoomNameChange={(name) => {
          renameRoom(roomId, name).then((updated) => {
            setRoomInfo((prev) => prev ? { ...prev, name: updated.name } : prev);
          }).catch(console.error);
        }}
        connectedUsers={connectedUsers}
      />
      <div
        ref={editorContainerRef}
        style={{ flex: 1, overflow: 'auto', fontSize: '14px' }}
      />
      {status === 'error' && (
        <div style={{ padding: '0.4rem 1rem', background: '#f38ba8', color: '#1e1e2e', fontSize: '0.8rem' }}>
          Connection error — retrying…
        </div>
      )}
    </div>
  );
}

/**
 * Reads the WS server URL from the Vite env variable, falling back to localhost
 * for local development. In production, set VITE_WS_URL in your deployment env.
 */
