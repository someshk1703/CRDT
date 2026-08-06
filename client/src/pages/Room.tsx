import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { basicSetup, EditorView } from 'codemirror';
import { Compartment } from '@codemirror/state';
import { useRealtimeChannel } from '../hooks/useRealtimeChannel';
import { useCRDT } from '../hooks/useCRDT';
import { usePresence } from '../hooks/usePresence';
import { useVoiceChat } from '../hooks/useVoiceChat';
import { useSession } from '../hooks/useSession';
import { getRoom, renameRoom, getCatchup, saveSnapshot, executeCode, type RoomInfo } from '../hooks/useRooms';
import { getLanguageExtension, getLanguageBoilerplate } from '../extensions/languageSwitcher';
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

/** Debounce delay for persisting a full CRDT snapshot after the user stops typing. */
const SNAPSHOT_DEBOUNCE_MS = 7_000;

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

  // Text of the scaffold we last auto-inserted, if the doc still matches it
  // untouched — lets a later language switch safely swap it for another one.
  const boilerplateRef = useRef<string | null>(null);

  // Minimap extension — computed once, stable reference
  const minimapExtension = useRef(
    showMinimap.compute(['doc'], () => ({
      create: () => { const dom = document.createElement('div'); return { dom }; },
      displayText: 'blocks' as const,
      showOverlay: 'mouse-over' as const,
    }))
  ).current;

  // Self identity broadcast over the Realtime channel (color is derived deterministically)
  const self = useMemo(() => {
    if (!session) return null;
    const meta = session.user.user_metadata as Record<string, unknown>;
    return {
      userId: session.user.id,
      username: (meta['user_name'] as string | undefined) ?? (meta['name'] as string | undefined) ?? 'anonymous',
      avatarUrl: (meta['avatar_url'] as string | undefined) ?? '',
    };
  }, [session]);

  // Editor mount + catchup-snapshot-loaded gates — the realtime channel only
  // subscribes once the last persisted snapshot has been applied, so broadcast
  // (which carries no history) never overwrites state loaded from persistence.
  const [editorReady, setEditorReady] = useState(false);
  const [catchupDone, setCatchupDone] = useState(false);

  // ── useCRDT ───────────────────────────────────────────────────────────────

  const {
    extensions: crdtExtensions,
    applyRemoteOp,
    setView: setCrdtView,
    sendRef,
    sendLanguageChange,
    getChars,
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

  // ── useVoiceChat (real-time mic audio between everyone in the room) ────────

  const { micOn, toggleMic, remoteStreams, voicePeerCount, handleSignal: handleVoiceSignal, handlePeerLeft } = useVoiceChat({
    userId: session?.user.id ?? 'anon',
    send: (msg) => sendFnRef.current(msg),
  });

  const handleMessage = useCallback(
    (msg: Parameters<typeof applyRemoteOp>[0]) => {
      applyRemoteOp(msg);
      handlePresenceMessage(msg);

      const raw = msg as Record<string, unknown>;
      const type = raw['type'];

      handleVoiceSignal(raw);
      if (type === 'user-left') {
        const leftId = raw['userId'];
        if (typeof leftId === 'string') handlePeerLeft(leftId);
      }

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
    [applyRemoteOp, handlePresenceMessage, handleVoiceSignal, handlePeerLeft],
  );

  const { send, status } = useRealtimeChannel(catchupDone ? (roomId ?? null) : null, self, handleMessage);
  sendRef.current = send;
  sendFnRef.current = send;

  // ── Catch-up: load the last persisted snapshot before the realtime channel
  // subscribes — broadcast is ephemeral, so this is the only source of state
  // for anything that happened before this client connects. ────────────────
  useEffect(() => {
    setCatchupDone(false);
    if (!roomId || !session || !editorReady) return;

    let cancelled = false;
    getCatchup(roomId)
      .then((catchup) => {
        if (cancelled) return;
        applyRemoteOp({
          type: 'catchup',
          roomId,
          userId: session.user.id,
          currentLanguage: catchup.currentLanguage,
          snapshot: catchup.snapshot ? { chars: catchup.snapshot.chars, lastClock: 0 } : null,
          ops: [],
        });

        // Brand-new room (nothing ever persisted) — seed the language scaffold
        // as a real local edit so it syncs/persists like any other keystroke.
        const view = viewRef.current;
        if (!catchup.snapshot && view && view.state.doc.length === 0) {
          const boilerplate = getLanguageBoilerplate(catchup.currentLanguage);
          view.dispatch({ changes: { from: 0, to: 0, insert: boilerplate } });
          boilerplateRef.current = boilerplate;
        }
      })
      .catch((err: unknown) => console.error('[room] catchup failed:', (err as Error).message))
      .finally(() => { if (!cancelled) setCatchupDone(true); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, session, editorReady]);

  // ── Debounced snapshot persistence ─────────────────────────────────────────

  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  const catchupDoneRef = useRef(catchupDone);
  catchupDoneRef.current = catchupDone;
  const getCharsRef = useRef(getChars);
  getCharsRef.current = getChars;
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSnapshotPersist = useCallback(() => {
    const rid = roomIdRef.current;
    if (!rid || !catchupDoneRef.current) return;
    if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current);
    snapshotTimerRef.current = setTimeout(() => {
      saveSnapshot(rid, getCharsRef.current()).catch((err: unknown) =>
        console.error('[room] snapshot persist failed:', (err as Error).message));
    }, SNAPSHOT_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => { if (snapshotTimerRef.current) clearTimeout(snapshotTimerRef.current); };
  }, []);

  const snapshotListenerExtension = useRef(
    EditorView.updateListener.of((update) => {
      if (update.docChanged) scheduleSnapshotPersist();
    }),
  ).current;

  // ── Load room metadata ────────────────────────────────────────────────────

  useEffect(() => {
    if (!roomId || !session) return;
    getRoom(roomId).then((info) => {
      if (!info) { setRoomNotFound(true); return; }
      setRoomInfo(info);
      setLanguage(info.language);
    }).catch(() => setRoomNotFound(true));
  }, [roomId, session]);

  // ── Run (Week 6 / serverless): proxy through /api/execute, then broadcast
  // the result to the room over the realtime channel so every peer — including
  // the initiator, since broadcast is configured with `self: true` — sees it. ──

  const runCode = useCallback(() => {
    if (!roomId) return;
    const code = viewRef.current?.state.doc.toString() ?? '';
    setIsRunning(true);
    setOutputLines([]);
    send({ type: 'exec-start', language });

    executeCode(roomId, language, code)
      .then((result) => {
        if (result.stdout) send({ type: 'exec-output', chunk: result.stdout, stream: 'stdout' });
        if (result.stderr) send({ type: 'exec-output', chunk: result.stderr, stream: 'stderr' });
        if (!result.ok) {
          send({ type: 'exec-error', reason: result.reason ?? 'service-unavailable', message: result.message ?? 'Execution failed' });
          return;
        }
        send({ type: 'exec-done', exitCode: result.exitCode });
      })
      .catch(() => {
        send({ type: 'exec-error', reason: 'service-unavailable', message: 'Failed to reach execution service' });
      });
  }, [roomId, language, send]);

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
        snapshotListenerExtension,
      ],
      parent: editorContainerRef.current,
    });

    viewRef.current = view;
    setCrdtView(view);
    setPresenceView(view);
    setEditorReady(true);

    return () => {
      view.destroy();
      viewRef.current = null;
      editorMountedRef.current = false;
      setEditorReady(false);
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
    return <div className="crdt-page" style={{ padding: '2rem', color: 'var(--text-primary)' }}>Loading…</div>;
  }

  if (!session) {
    navigate('/');
    return null;
  }

  if (!roomId) {
    return <div className="crdt-page" style={{ padding: '2rem', color: 'var(--accent-red)' }}>
      No room ID in URL. <a href="/" style={{ color: 'var(--accent-cyan)' }}>Go home</a>.
    </div>;
  }

  if (roomNotFound) {
    return <div className="crdt-page" style={{ padding: '2rem', color: 'var(--accent-red)' }}>
      Room not found. <a href="/" style={{ color: 'var(--accent-cyan)' }}>Go home</a>.
    </div>;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="crdt-page" style={{ display: 'flex', flexDirection: 'column', height: '100vh', padding: '1.25rem' }}>
      <div className="crdt-box crdt-box--live" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <Toolbar
          roomName={roomInfo?.name ?? roomId}
          roomSlug={roomId}
          language={language}
          theme={theme}
          onThemeChange={setTheme}
          onLanguageChange={(lang) => {
            setLanguage(lang);
            sendLanguageChange(lang);
            // Swap the scaffold for the new language, but only while the doc is
            // empty or still exactly the scaffold we last auto-inserted — never
            // clobber code someone actually wrote.
            const view = viewRef.current;
            if (!view) return;
            const currentText = view.state.doc.toString();
            if (currentText.length === 0 || currentText === boilerplateRef.current) {
              const boilerplate = getLanguageBoilerplate(lang);
              view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: boilerplate } });
              boilerplateRef.current = boilerplate;
            }
          }}
          onRoomNameChange={(name) => {
            renameRoom(roomId, name).then((updated) => {
              setRoomInfo((prev) => prev ? { ...prev, name: updated.name } : prev);
              send({ type: 'room-meta', name: updated.name });
            }).catch(console.error);
          }}
          connectedUsers={connectedUsers}
          isRunning={isRunning}
          onRun={runCode}
          micOn={micOn}
          onToggleMic={toggleMic}
          voicePeerCount={voicePeerCount}
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
          <div style={{ padding: '0.4rem 1rem', background: 'var(--accent-red)', color: 'var(--bg-primary)', fontSize: '0.8rem' }}>
            Connection error — retrying…
          </div>
        )}
        {/* Hidden players for remote peers' mic audio */}
        {Object.entries(remoteStreams).map(([peerId, stream]) => (
          <audio
            key={peerId}
            autoPlay
            ref={(el) => { if (el) el.srcObject = stream; }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Reads the WS server URL from the Vite env variable, falling back to localhost
 * for local development. In production, set VITE_WS_URL in your deployment env.
 */
