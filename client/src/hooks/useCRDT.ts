import { useCallback, useRef } from 'react';
import type React from 'react';
import { EditorView } from 'codemirror';
import { Annotation, type Extension } from '@codemirror/state';
import { RGADocument } from '@crdt/shared/crdt';
import type { AppMessage, CRDTInsertMessage, CRDTDeleteMessage, CatchupMessage } from '@crdt/shared';

// ── Annotation ────────────────────────────────────────────────────────────────

/**
 * Annotation used to mark CodeMirror transactions dispatched by the CRDT hook.
 * The local change listener checks for this to avoid re-broadcasting remote ops.
 */
export const remoteAnnotation = Annotation.define<boolean>();

// ── Types ─────────────────────────────────────────────────────────────────────

interface UseCRDTOptions {
  /**
   * Called after each remote op is applied to the document with the diff info.
   * Used by Week 3 presence to reconcile remote cursor positions.
   *
   * @param from     Start offset of the changed region
   * @param removed  Number of characters removed
   * @param inserted Number of characters inserted
   */
  onRemoteChange?: (from: number, removed: number, inserted: number) => void;
}

interface UseCRDTReturn {
  /** CodeMirror extensions to include when mounting the EditorView. */
  extensions: Extension[];
  /**
   * Pass this as `onMessage` to `useWebSocket`.
   * Applies incoming CRDT ops and updates the editor.
   */
  applyRemoteOp: (msg: AppMessage | Record<string, unknown>) => void;
  /** Call once after the EditorView is created to register the view reference. */
  setView: (view: EditorView) => void;
  /**
   * A stable ref to the send function. Assign `sendRef.current = send` after
   * useWebSocket provides the real send function each render.
   */
  sendRef: React.MutableRefObject<(msg: object) => void>;
}

/**
 * Bridges RGADocument ↔ CodeMirror ↔ WebSocket for Week 2+.
 *
 * - Local edits: CodeMirror Transaction → CRDT op → broadcast
 * - Remote edits: received CRDT op → RGADocument → CodeMirror Transaction
 *
 * Week 3 addition: `options.onRemoteChange` fires after every remote op so
 * that presence cursors can be reconciled.
 */
export function useCRDT(
  userId: string,
  roomId: string,
  options?: UseCRDTOptions,
): UseCRDTReturn {
  const docRef = useRef<RGADocument>(new RGADocument(userId));
  const viewRef = useRef<EditorView | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const sendRef = useRef<(msg: object) => void>(() => {});
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;

  // Keep onRemoteChange stable via ref to avoid recreating applyRemoteOp
  const onRemoteChangeRef = useRef(options?.onRemoteChange);
  onRemoteChangeRef.current = options?.onRemoteChange;

  // ── Local change listener ─────────────────────────────────────────────────

  const localChangeExtension: Extension = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;

    const doc = docRef.current;
    const send = sendRef.current;
    const userId = userIdRef.current;
    const roomId = roomIdRef.current;

    update.transactions.forEach((tr) => {
      if (tr.annotation(remoteAnnotation)) return;

      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        // 1. Process deletions first (positions reference the pre-change document)
        for (let i = toA - 1; i >= fromA; i--) {
          try {
            const deleted = doc.localDelete(i);
            send({ type: 'crdt-delete' as const, userId, roomId, charId: deleted.id });
          } catch {
            console.warn('[useCRDT] localDelete out of range at', i);
          }
        }

        // 2. Process insertions
        const insertedStr = inserted.toString();
        let insertPos = fromA;
        for (const char of insertedStr) {
          const crdt = doc.localInsert(insertPos, char, userId);
          send({ type: 'crdt-insert' as const, userId, roomId, char: crdt });
          insertPos++;
        }
      });
    });
  });

  // ── Remote op handler ─────────────────────────────────────────────────────

  const applyRemoteOp = useCallback(
    (msg: AppMessage | Record<string, unknown>) => {
      const view = viewRef.current;
      if (!view) return;

      const doc = docRef.current;
      const type = (msg as Record<string, unknown>)['type'];

      if (type === 'crdt-insert') {
        const insertMsg = msg as CRDTInsertMessage;
        const prevText = doc.getText();
        doc.remoteInsert(insertMsg.char);
        const newText = doc.getText();
        const diff = applyTextDiff(view, prevText, newText);
        if (diff) {
          onRemoteChangeRef.current?.(diff.from, diff.removed, diff.inserted);
        }
      } else if (type === 'crdt-delete') {
        const deleteMsg = msg as CRDTDeleteMessage;
        const prevText = doc.getText();
        doc.remoteDelete(deleteMsg.charId);
        const newText = doc.getText();
        const diff = applyTextDiff(view, prevText, newText);
        if (diff) {
          onRemoteChangeRef.current?.(diff.from, diff.removed, diff.inserted);
        }
      } else if (type === 'catchup') {
        const catchupMsg = msg as CatchupMessage;
        if (catchupMsg.snapshot) {
          doc.loadFromChars(catchupMsg.snapshot.chars);
        }
        for (const op of catchupMsg.ops) {
          if (op.op_type === 'insert') {
            doc.remoteInsert(op.payload as import('@crdt/shared/crdt').CRDTChar);
          } else {
            doc.remoteDelete((op.payload as { charId: string }).charId);
          }
        }
        const newText = doc.getText();
        applyTextDiff(view, view.state.doc.toString(), newText);
      }
      // Other message types (presence, welcome, user-joined/left) are handled
      // by usePresence — ignored here.
    },
    [],
  );

  const setView = useCallback((view: EditorView) => {
    viewRef.current = view;
  }, []);

  return { extensions: [localChangeExtension], applyRemoteOp, setView, sendRef };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface DiffResult {
  from: number;
  removed: number;
  inserted: number;
}

/**
 * Compute a minimal diff between prevText and newText, dispatch a CodeMirror
 * transaction to apply it, and return the diff info for cursor reconciliation.
 *
 * Returns null if the texts are identical (no-op).
 */
function applyTextDiff(
  view: EditorView,
  prevText: string,
  newText: string,
): DiffResult | null {
  if (prevText === newText) return null;

  // Find common prefix
  let from = 0;
  while (from < prevText.length && from < newText.length && prevText[from] === newText[from]) {
    from++;
  }

  // Find common suffix
  let prevEnd = prevText.length;
  let newEnd = newText.length;
  while (prevEnd > from && newEnd > from && prevText[prevEnd - 1] === newText[newEnd - 1]) {
    prevEnd--;
    newEnd--;
  }

  view.dispatch({
    changes: { from, to: prevEnd, insert: newText.slice(from, newEnd) },
    annotations: remoteAnnotation.of(true),
  });

  return {
    from,
    removed: prevEnd - from,
    inserted: newEnd - from,
  };
}

