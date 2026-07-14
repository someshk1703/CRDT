import { useCallback, useRef } from 'react';
import type React from 'react';
import { EditorView } from 'codemirror';
import type { Extension } from '@codemirror/state';
import { RGADocument } from '@crdt/shared/crdt';
import type { AppMessage, CRDTInsertMessage, CRDTDeleteMessage } from '@crdt/shared';

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
 * Bridges RGADocument ↔ CodeMirror ↔ WebSocket for Week 2.
 *
 * - Local edits: CodeMirror Transaction → CRDT op → broadcast
 * - Remote edits: received CRDT op → RGADocument → CodeMirror Transaction
 *
 * The hook owns:
 * - One RGADocument (stable ref — never triggers re-renders)
 * - One EditorView ref (set externally after mount)
 *
 * `sendRef` is exposed so that Room.tsx can update it after useWebSocket
 * provides the real send function, avoiding hook ordering issues.
 */
export function useCRDT(
  userId: string,
  roomId: string,
): UseCRDTReturn {
  const docRef = useRef<RGADocument>(new RGADocument(userId));
  const viewRef = useRef<EditorView | null>(null);

  // Exposed so Room.tsx can assign the real send after useWebSocket initialises
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const sendRef = useRef<(msg: object) => void>(() => {});
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;

  // ── Local change listener ─────────────────────────────────────────────────

  const localChangeExtension: Extension = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;

    const doc = docRef.current;
    const send = sendRef.current;
    const userId = userIdRef.current;
    const roomId = roomIdRef.current;

    update.transactions.forEach((tr) => {
      // We only care about user-initiated changes, not remote-applied ones.
      // Remote ops are dispatched with the `remote` annotation to skip this.
      if (tr.annotation(remoteAnnotation)) return;

      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        // 1. Process deletions first (positions reference the pre-change document)
        for (let i = toA - 1; i >= fromA; i--) {
          try {
            const deleted = doc.localDelete(i);
            send({
              type: 'crdt-delete' as const,
              userId,
              roomId,
              charId: deleted.id,
            });
          } catch {
            // Defensive: position out of range (can happen during complex transactions)
            console.warn('[useCRDT] localDelete out of range at', i);
          }
        }

        // 2. Process insertions
        const insertedStr = inserted.toString();
        let insertPos = fromA; // position in visible text after deletions
        for (const char of insertedStr) {
          const crdt = doc.localInsert(insertPos, char, userId);
          send({
            type: 'crdt-insert' as const,
            userId,
            roomId,
            char: crdt,
          });
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
        applyTextDiff(view, prevText, newText);
      } else if (type === 'crdt-delete') {
        const deleteMsg = msg as CRDTDeleteMessage;
        const prevText = doc.getText();
        doc.remoteDelete(deleteMsg.charId);
        const newText = doc.getText();
        applyTextDiff(view, prevText, newText);
      }
      // Other message types (presence, user-joined, etc.) are ignored here
    },
    [],
  );

  const setView = useCallback((view: EditorView) => {
    viewRef.current = view;
  }, []);

  return { extensions: [localChangeExtension], applyRemoteOp, setView, sendRef };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

import { Annotation } from '@codemirror/state';

/**
 * Annotation used to mark CodeMirror transactions dispatched by the CRDT hook.
 * The local change listener checks for this to avoid re-broadcasting remote ops.
 */
export const remoteAnnotation = Annotation.define<boolean>();

/**
 * Compute a minimal diff between prevText and newText, then dispatch a
 * CodeMirror transaction to update the editor content.
 *
 * Strategy: find the common prefix length and common suffix length, then
 * replace only the changed middle section.
 */
function applyTextDiff(view: EditorView, prevText: string, newText: string): void {
  if (prevText === newText) return;

  // Find common prefix
  let from = 0;
  while (from < prevText.length && from < newText.length && prevText[from] === newText[from]) {
    from++;
  }

  // Find common suffix (working backwards from end)
  let prevEnd = prevText.length;
  let newEnd = newText.length;
  while (prevEnd > from && newEnd > from && prevText[prevEnd - 1] === newText[newEnd - 1]) {
    prevEnd--;
    newEnd--;
  }

  view.dispatch({
    changes: {
      from,
      to: prevEnd,
      insert: newText.slice(from, newEnd),
    },
    annotations: remoteAnnotation.of(true),
  });
}
