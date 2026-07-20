/**
 * usePresence — manages live cursor/awareness state for Week 3.
 *
 * Responsibilities:
 *  - Receives `welcome`, `presence`, and `user-left` messages and routes them.
 *  - Sends outgoing presence updates (debounced at 50 ms).
 *  - Reconciles remote cursor positions after local CRDT ops shift the document.
 *  - Drives the presenceCursors CodeMirror extension via updatePresenceEffect.
 */

import { useCallback, useEffect, useRef } from 'react';
import type { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { AppMessage } from '@crdt/shared';
import {
  presenceCursors,
  updatePresenceEffect,
  type PresenceState,
} from '../extensions/presenceCursors';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UsePresenceOptions {
  userId: string;
  roomId: string;
  /** Stable send function from useWebSocket. */
  send: (msg: object) => void;
  /** Debounce delay for outgoing presence messages. Default: 50 ms. */
  debounceMs?: number;
}

export interface UsePresenceReturn {
  /** Pass to useWebSocket's onMessage alongside useCRDT's applyRemoteOp. */
  handleMessage: (msg: AppMessage | Record<string, unknown>) => void;
  /** Call with the current CodeMirror selection to broadcast your cursor. Debounced. */
  sendPresence: (cursor: { from: number; to: number }) => void;
  /** Register the EditorView after it has been mounted. */
  setView: (view: EditorView) => void;
  /** CodeMirror extensions — include in EditorView along with CRDT extensions. */
  extensions: Extension;
  /**
   * Called by useCRDT after every remote op is applied.
   * Walks all tracked remote cursors through the adjustment formula and
   * dispatches updatePresenceEffect so decorations rebuild immediately.
   *
   * @param from     Start offset of the changed region in the document
   * @param removed  Number of characters removed
   * @param inserted Number of characters inserted
   */
  reconcileCursors: (from: number, removed: number, inserted: number) => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function usePresence({
  userId,
  roomId,
  send,
  debounceMs = 50,
}: UsePresenceOptions): UsePresenceReturn {
  const viewRef = useRef<EditorView | null>(null);

  // Server-assigned colour received via welcome message
  const colorRef = useRef<string>('#89b4fa');

  // Stable ref to the send function to avoid stale closures in debounce callbacks
  const sendRef = useRef(send);
  sendRef.current = send;

  // Debounce state
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCursorRef = useRef<{ from: number; to: number } | null>(null);

  // Mirror of what's in the presenceField StateField — used for reconciliation
  // without reading the editor state (which may be null during unmount)
  const presenceMapRef = useRef<Map<string, PresenceState>>(new Map());

  // ── setView ─────────────────────────────────────────────────────────────────

  const setView = useCallback((view: EditorView) => {
    viewRef.current = view;
  }, []);

  // ── Low-level effect dispatcher ──────────────────────────────────────────────

  const dispatchEffect = useCallback(
    (remoteUserId: string, state: PresenceState | null) => {
      const view = viewRef.current;
      if (!view) return;

      view.dispatch({ effects: updatePresenceEffect.of({ userId: remoteUserId, state }) });

      // Keep the local mirror in sync
      if (state === null) {
        presenceMapRef.current.delete(remoteUserId);
      } else {
        presenceMapRef.current.set(remoteUserId, state);
      }
    },
    [],
  );

  // ── Message handler ──────────────────────────────────────────────────────────

  const handleMessage = useCallback(
    (msg: AppMessage | Record<string, unknown>) => {
      const type = (msg as Record<string, unknown>)['type'];

      if (type === 'welcome') {
        // Server-assigned colour for our own outgoing presence messages
        const color = (msg as Record<string, unknown>)['color'];
        if (typeof color === 'string' && color.length > 0) {
          colorRef.current = color;
        }
        return;
      }

      if (type === 'presence') {
        const m = msg as {
          userId: string;
          cursor: { from: number; to: number };
          name: string;
          color: string;
        };
        // Ignore our own presence echoed back (server excludes sender, but be defensive)
        if (m.userId === userId) return;

        dispatchEffect(m.userId, {
          cursor: m.cursor,
          name: m.name,
          color: m.color,
        });
        return;
      }

      if (type === 'user-left') {
        const leftId = (msg as Record<string, unknown>)['userId'];
        if (typeof leftId === 'string') {
          dispatchEffect(leftId, null);
        }
      }
    },
    [userId, dispatchEffect],
  );

  // ── sendPresence (debounced) ─────────────────────────────────────────────────

  const sendPresence = useCallback(
    (cursor: { from: number; to: number }) => {
      pendingCursorRef.current = cursor;

      // Reset the debounce timer on every call
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }

      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        const pending = pendingCursorRef.current;
        if (!pending) return;

        sendRef.current({
          type: 'presence',
          userId,
          roomId,
          cursor: pending,
          name: `User-${userId.slice(0, 4).toUpperCase()}`,
          color: colorRef.current,
        });
      }, debounceMs);
    },
    [userId, roomId, debounceMs],
  );

  // ── reconcileCursors ─────────────────────────────────────────────────────────

  const reconcileCursors = useCallback(
    (from: number, removed: number, inserted: number) => {
      const view = viewRef.current;
      if (!view || presenceMapRef.current.size === 0) return;

      for (const [remoteUserId, state] of presenceMapRef.current) {
        const newFrom = adjustPosition(state.cursor.from, from, removed, inserted);
        const newTo = adjustPosition(state.cursor.to, from, removed, inserted);

        if (newFrom !== state.cursor.from || newTo !== state.cursor.to) {
          const updated: PresenceState = { ...state, cursor: { from: newFrom, to: newTo } };
          // Update the mirror first so we don't re-process the same entry
          presenceMapRef.current.set(remoteUserId, updated);
          view.dispatch({
            effects: updatePresenceEffect.of({ userId: remoteUserId, state: updated }),
          });
        }
      }
    },
    [],
  );

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return {
    handleMessage,
    sendPresence,
    setView,
    extensions: presenceCursors,
    reconcileCursors,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Adjust a cursor position after a document change.
 *
 * @param pos      Original position in the document
 * @param from     Start of the changed region
 * @param removed  Number of characters removed
 * @param inserted Number of characters inserted
 */
function adjustPosition(pos: number, from: number, removed: number, inserted: number): number {
  if (pos <= from) {
    return pos; // before the change — unchanged
  }
  if (removed > 0 && pos < from + removed) {
    // Was inside the deleted region — collapse to insertion point
    return from + inserted;
  }
  // After the change — shift by net delta
  return pos - removed + inserted;
}
