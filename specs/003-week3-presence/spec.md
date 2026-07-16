# Spec 003 — Week 3: Presence (Live Cursors & Awareness)

## Goal

Every user sees every other user's cursor position, selection range, name, and colour — live — without presence events interfering with CRDT document sync.

Presence is a **separate concern** from document sync:
- Presence messages can be dropped with no consequence; CRDT ops cannot.
- Presence travels on its own message type and is never merged with CRDT state.

---

## Functional Requirements

### FR-001 — Presence protocol
- Define `PresenceMessage: {type:"presence", userId, roomId, cursor:{from,to}, name, color}`.
- The server routes `presence` messages as a relay only (no state stored server-side beyond the session).
- The server sends a `welcome` message to each connecting client with their assigned `color` and `roomId`.

### FR-002 — Identity and colour
- Server assigns each connecting client a colour from an 8-colour palette; stable for the session.
- The client receives its colour via the `welcome` message and uses it in all `presence` messages.
- Display name: `User-XXXX` where XXXX is the first 4 chars of the client's self-generated UUID.

### FR-003 — Cursor caret rendering
- Remote users' cursors render as a coloured vertical bar (2 px) with a floating name label above.
- Implemented as a CodeMirror 6 `ViewPlugin` + `WidgetType`.

### FR-004 — Selection range rendering
- When a remote user has a non-collapsed selection (`from !== to`), their selected range is highlighted in their colour at 25 % opacity with a coloured bottom border.
- Implemented as `Decoration.mark` (not a widget).

### FR-005 — Outgoing throttle
- Outgoing presence updates are debounced at **50 ms**; cursor position is not critical-path data.

### FR-006 — Offline cleanup
- When a client disconnects, the server broadcasts `{type:"user-left", userId, roomId}`.
- On `user-left`, all remaining clients remove that user's cursor decoration immediately.
- The `user-left` message carries the client's self-reported `userId` (the one used in `presence` messages), not a server-internal connection ID.

### FR-007 — Cursor reconciliation after remote ops (CRDT-position safety)
- When a remote CRDT op shifts the document, every tracked remote cursor position is adjusted through the same insertion/deletion arithmetic.
- Formula for one cursor point `pos` given change `{from, removed, inserted}`:
  - `pos <= from` → unchanged
  - `removed > 0 && from < pos < from + removed` → `from + inserted` (was inside deleted region, collapse to insertion point)
  - `pos >= from + removed` → `pos - removed + inserted`
- After adjustment, `updatePresenceEffect` is dispatched so decorations rebuild immediately.

---

## Non-Functional Requirements

### NFR-001 — No presence leak into CRDT path
- `useCRDT` dispatches remote ops with `remoteAnnotation`; the presence cursor extension must not interfere with CRDT transaction processing.

### NFR-002 — Decoration safety
- All cursor positions are clamped to `[0, doc.length]` before building decorations to prevent CodeMirror range errors.
- Decoration.set is wrapped in try/catch for resilience.

### NFR-003 — Performance
- The `ViewPlugin` only rebuilds decorations when `docChanged` or `updatePresenceEffect` is present on a transaction.
- Presence messages are debounced at 50 ms; they do not fire on every keystroke.

---

## Message Types

| Message         | Direction        | Purpose |
|-----------------|------------------|---------|
| `welcome`       | Server → Client  | Assign colour on connect |
| `presence`      | Client → Server → peers | Cursor/selection broadcast |
| `user-joined`   | Server → peers   | Inform room of new arrival |
| `user-left`     | Server → peers   | Clean up cursor decoration |

---

## Architecture

```
Room.tsx
├── useCRDT(userId, roomId, { onRemoteChange })   ← adds cursor reconcile callback
├── usePresence(userId, roomId, send)              ← NEW
│     ├── handles: welcome, presence, user-left messages
│     ├── sendPresence(cursor) — debounced 50ms
│     ├── reconcileCursors(from, removed, inserted) — called by useCRDT
│     └── returns: extensions [presenceCursors], handleMessage, setView
└── EditorView
      extensions: [basicSetup, javascript(), ...crdtExtensions, ...presenceExtensions]
```

```
client/src/extensions/presenceCursors.ts   ← NEW
  updatePresenceEffect (StateEffect)
  presenceField (StateField<Map<userId, PresenceState>>)
  presencePlugin (ViewPlugin with DecorationSet)
  presenceCursors (Extension bundle)
```

---

## End-of-Week Acceptance Criteria

- [ ] Two+ tabs see each other's live cursors with correct name/colour
- [ ] Selections (not just carets) render in the remote user's colour
- [ ] A remote insert/delete correctly shifts other users' cursor positions — no drift after repeated concurrent edits
- [ ] A disconnected user's cursor disappears promptly for all remaining clients
- [ ] Presence messages are not emitted on every keystroke (≤1 message per 50 ms)
