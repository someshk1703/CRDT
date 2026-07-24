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
import { getThemeExtension, DEFAULT_THEME } from '../extensions/themeSwitcher';
import { showMinimap } from '@replit/codemirror-minimap';
import { Toolbar } from '../components/Toolbar';
import { OutputPanel, type OutputLine } from '../components/OutputPanel';

// Inject editor-level global styles once (scrollbar + minimap)
(function injectEditorGlobalStyles() {
  if (document.getElementById('crdt-editor-styles')) return;
  const s = document.createElement('style');
  s.id = 'crdt-editor-styles';
  s.textContent = `
    /* Slim VS Code-style scrollbar (visible only when minimap is off) */
    .cm-scroller {
      scrollbar-width: thin;
      scrollbar-color: rgba(180,180,180,0.18) transparent;
    }
    .cm-scroller::-webkit-scrollbar { width: 6px; height: 6px; }
    .cm-scroller::-webkit-scrollbar-track { background: transparent; }
    .cm-scroller::-webkit-scrollbar-thumb {
      background: rgba(180,180,180,0.18);
      border-radius: 3px;
    }
    .cm-scroller::-webkit-scrollbar-thumb:hover {
      background: rgba(180,180,180,0.38);
    }
    .cm-scroller::-webkit-scrollbar-corner { background: transparent; }

    /* ── Minimap VS Code styling ─────────────────────────────────── */
    .cm-minimap-wrap {
      border-left: 1px solid rgba(255,255,255,0.06) !important;
    }
    .cm-minimap-gutter {
      background: transparent !important;
    }
    /* Thinner minimap — override default 120px max-width */
    .cm-minimap-inner,
    .cm-minimap-inner canvas {
      max-width: 60px !important;
      width: 60px !important;
    }
  `;
  document.head.appendChild(s);
})();

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
  const [theme, setTheme] = useState(DEFAULT_THEME);

  // ── Execution state (Week 6) ──────────────────────────────────────────────
  const [outputLines, setOutputLines] = useState<OutputLine[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const outputLineId = useRef(0);
  const languageCompartment = useRef(new Compartment()).current;
  const themeCompartment = useRef(new Compartment()).current;

  // Minimap extension — computed once, stable reference
  const minimapExtension = useRef(
    showMinimap.compute(['doc'], () => ({
      create: () => { const dom = document.createElement('div'); return { dom }; },
      displayText: 'blocks' as const,
      showOverlay: 'mouse-over' as const,
    }))
  ).current;

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

      const raw = msg as Record<string, unknown>;
      const type = raw['type'];

      // room-meta: update room name
      if (type === 'room-meta') {
        const name = raw['name'] as string;
        if (name) setRoomInfo((prev) => prev ? { ...prev, name } : prev);
      }

      // ── Execution messages (Week 6) ──────────────────────────────────────
      if (type === 'exec-start') {
        setIsRunning(true);
        setOutputLines([]);
      }

      if (type === 'exec-output') {
        const chunk = (raw['chunk'] as string) ?? '';
        const stream = (raw['stream'] === 'stderr' ? 'stderr' : 'stdout') as OutputLine['stream'];
        setOutputLines((prev) => [
          ...prev,
          { id: ++outputLineId.current, text: chunk, stream },
        ]);
      }

      if (type === 'exec-done') {
        const exitCode = (raw['exitCode'] as number) ?? 0;
        setIsRunning(false);
        setOutputLines((prev) => [
          ...prev,
          {
            id: ++outputLineId.current,
            text: `\nProcess exited with code ${exitCode}`,
            stream: 'system',
          },
        ]);
      }

      if (type === 'exec-error') {
        const message = (raw['message'] as string) ?? 'Unknown error';
        setIsRunning(false);
        setOutputLines((prev) => [
          ...prev,
          { id: ++outputLineId.current, text: `\nError: ${message}`, stream: 'stderr' },
        ]);
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
        themeCompartment.of(getThemeExtension(theme)),
        minimapExtension,
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
  }, [authLoading]);

  // Update language compartment when language state changes after mount
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: languageCompartment.reconfigure(getLanguageExtension(language)),
      });
    }
  }, [language, languageCompartment]);

  // Update theme compartment when theme state changes
  useEffect(() => {
    if (viewRef.current) {
      viewRef.current.dispatch({
        effects: themeCompartment.reconfigure(getThemeExtension(theme)),
      });
    }
  }, [theme, themeCompartment]);

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
        theme={theme}
        onThemeChange={setTheme}
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
        isRunning={isRunning}
        onRun={() => {
          const code = viewRef.current?.state.doc.toString() ?? '';
          send({ type: 'exec-run', roomId, language, code });
        }}
      />
      <div
        ref={editorContainerRef}
        style={{ flex: 1, overflow: 'auto', fontSize: '14px', minHeight: 0 }}
      />
      <OutputPanel
        lines={outputLines}
        isRunning={isRunning}
        onClear={() => setOutputLines([])}
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
