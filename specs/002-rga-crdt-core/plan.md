# Implementation Plan: Week 2 — RGA CRDT Core

**Feature Branch**: `002-rga-crdt-core`
**Created**: 2026-07-14
**Based on**: spec.md

---

## Overview

Week 2 adds the RGA CRDT algorithm that makes concurrent edits converge without a server
arbitrator. The plan follows the Week 2 daily guide and is split into four phases:

1. **Core algorithm** — `CRDTChar`, `LamportClock`, `RGADocument` as pure TypeScript
2. **Wire protocol** — update shared types; server broadcasts CRDT messages
3. **CodeMirror integration** — `useCRDT` hook wiring local/remote ops
4. **Convergence validation** — unit tests + two-tab manual test

All changes are backward-compatible with Week 1 (the old `OpMessage` type is kept; the server
adds routing for the two new message types).

---

## Phase 1 — CRDT Core Library (`shared/src/crdt.ts`)

### Design

The entire algorithm lives in `shared/src/crdt.ts` as a pure ES module with **no runtime
dependencies**. This makes it independently testable with Vitest and reusable by both the
client (React) and, later, the server (Node.js).

```
shared/src/
├── index.ts       ← exports AppMessage union + re-exports from crdt.ts
└── crdt.ts        ← NEW: CRDTChar, LamportClock, RGADocument
```

### CRDTChar

```ts
export interface CRDTChar {
  readonly id: string;        // "clientId:lamportTick"
  readonly value: string;     // single character
  readonly originId: string | null;  // ID of left neighbour at insert time
  deleted: boolean;           // tombstone flag; never removed from array
}
```

### LamportClock

Simple scalar clock:
- `tick()` → `++this.time` → return
- `update(received)` → `this.time = Math.max(this.time, received) + 1`

### RGADocument

Internal state: `readonly chars: CRDTChar[]` (includes tombstones).

Key operations:

| Method | Complexity | Notes |
|--------|-----------|-------|
| `localInsert(visiblePos, value, clientId)` | O(n) | Scans visible chars to find left neighbour |
| `localDelete(visiblePos)` | O(n) | Finds nth visible char, marks tombstone |
| `remoteInsert(char)` | O(n) | Idempotent; uses `integrateInsert` |
| `remoteDelete(charId)` | O(n) | Idempotent; finds by ID |
| `getText()` | O(n) | Returns visible chars joined |
| `getVisibleLength()` | O(n) | Count non-tombstoned |

**`integrateInsert` algorithm** (RGA tie-breaking):

```
1. Find the position of originId in chars[] (index i, or -1 for head)
2. Starting from i+1, scan right while:
     - chars[j].originId === char.originId  (same origin = concurrent)
     - AND chars[j].id > char.id            (existing char "wins" — keep scanning)
3. Insert char at position j
```

This guarantees: same sequence on all clients regardless of arrival order.

---

## Phase 2 — Wire Protocol (`shared/src/index.ts` + `server/src/index.ts`)

### New message types

```ts
// shared/src/index.ts additions
export interface CRDTInsertMessage extends BaseMessage {
  type: 'crdt-insert';
  char: CRDTChar;
}

export interface CRDTDeleteMessage extends BaseMessage {
  type: 'crdt-delete';
  charId: string;
}

// AppMessage union expands to include both
```

### Server routing

`server/src/index.ts` — in the `message` handler, add cases:
```
case 'crdt-insert':
case 'crdt-delete':
  roomManager.broadcast(client.roomId, data, client.id);
  break;
```

Validation: `crdt-delete` must have a non-empty `charId` string; reject with a log if missing
(do not broadcast). No other server-side validation needed in Week 2.

---

## Phase 3 — CodeMirror Integration (`client/src/hooks/useCRDT.ts`)

### `useCRDT` hook contract

```ts
function useCRDT(
  send: (msg: object) => void,
  userId: string,
): {
  extensions: Extension[];           // CodeMirror extensions to mount
  applyRemoteOp: (msg: AppMessage) => void;  // called from useWebSocket.onMessage
}
```

The hook owns:
- One `RGADocument` instance (ref — not state, no re-renders)
- One `LamportClock` instance (ref)
- An `EditorView` ref (set via a CodeMirror `ViewPlugin` or passed in)

### Local change flow

```
CodeMirror Transaction
  → iterChanges(fromA, toA, fromB, toB, inserted)
  → inserted.length > 0 → localInsert(visiblePos, char, userId) × chars
  → toA > fromA         → localDelete(visiblePos) × (toA - fromA) deletions
  → send({ type: 'crdt-insert' | 'crdt-delete', ... })
```

Position mapping: `fromA` is the visible-text offset. The CRDT's `localInsert` / `localDelete`
accept visible indices, so no additional offset conversion is needed.

### Remote op flow

```
onMessage(data: AppMessage)
  → if type === 'crdt-insert'  → doc.remoteInsert(data.char)
  → if type === 'crdt-delete'  → doc.remoteDelete(data.charId)
  → compute diff: prevText vs doc.getText()
  → view.dispatch({ changes: { from, to, insert } })
```

Diff strategy: use `prevText` snapshot before applying op; find the minimal `from/to/insert`
to update CodeMirror. For Week 2 this is a simple full-replace fallback if diff is complex
(acceptable; cursor drift is a known carry-forward).

### Room.tsx changes

- Add `useCRDT(send, userId)` call; spread `extensions` into `EditorView`
- Pass `applyRemoteOp` to `useWebSocket.onMessage`
- Remove the Week 1 `EditorView.updateListener` raw-op broadcaster
- `userId` is stored in a `useRef` initialised to `crypto.randomUUID()` on first render

---

## Phase 4 — Tests

### Unit tests: `shared/src/crdt.test.ts`

| Test | Covers |
|------|--------|
| LamportClock tick sequence | FR-006 |
| LamportClock update | FR-006, FR-007 |
| localInsert single char | FR-002 |
| localInsert multiple chars in sequence | FR-002 |
| localDelete marks tombstone | FR-004 |
| getText skips tombstones | FR-001 |
| Two-client concurrent insert same origin → convergence | FR-003 |
| Two-client concurrent insert+delete → no corruption | FR-005 |
| remoteInsert idempotency | FR-005 |
| remoteDelete idempotency | FR-005 |
| remoteDelete on unknown charId is a no-op | FR-005 |

### Manual convergence test (two tabs)

1. Start server + client
2. Open tab A and tab B in the same room
3. Type "X" in tab A and "Y" in tab B simultaneously
4. Assert both tabs display the same 2-character string
5. Delete the first character in tab A simultaneously with an insert in tab B at position 0
6. Assert both tabs display the same final text

---

## File Change Summary

| File | Action | Scope |
|------|--------|-------|
| `shared/src/crdt.ts` | **CREATE** | `CRDTChar`, `LamportClock`, `RGADocument` |
| `shared/src/crdt.test.ts` | **CREATE** | Vitest unit tests |
| `shared/src/index.ts` | **MODIFY** | Add `CRDTInsertMessage`, `CRDTDeleteMessage`, export `CRDTChar` |
| `server/src/index.ts` | **MODIFY** | Route `crdt-insert` / `crdt-delete` in message handler |
| `client/src/hooks/useCRDT.ts` | **CREATE** | CRDT ↔ CodeMirror bridge hook |
| `client/src/pages/Room.tsx` | **MODIFY** | Replace Week 1 raw-op listener; wire `useCRDT` |

No new npm packages. No schema migrations. No environment variable changes.

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Off-by-one in `integrateInsert` scan | Unit test with concurrent same-origin pairs |
| CodeMirror position mismatch after remote op | Full-text replace fallback; flag cursor drift for Week 3 |
| Out-of-order remote ops (delete before insert) | `remoteDelete` no-ops on unknown charId; op is effectively lost — acceptable for Week 2 |
| Paste → flood of small messages | 50 ops/sec rate limit already in server; paste of 200 chars fits within 1 s budget |
