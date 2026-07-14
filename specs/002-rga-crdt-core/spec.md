# Feature Specification: Week 2 — RGA CRDT Core

**Feature Branch**: `002-rga-crdt-core`
**Created**: 2026-07-14
**Status**: Active
**Week**: 2 of 6

## Goal

By end of week: two browser tabs typing simultaneously at the same position converge to the
identical document, with no central server making ordering decisions.

The core algorithm is **RGA (Replicated Growable Array)** — every character gets a globally
unique ID and an "origin" pointer to whatever was immediately left of it at insert time.
Commutativity + unique IDs means no coordinator is needed to settle conflicts.

**End-of-week definition of done**:
- [ ] Two tabs typing simultaneously at the same position converge to the same document
- [ ] Delete + concurrent insert near the deleted position does not corrupt the document
- [ ] Tombstones, `originId`, and tie-breaking are explainable without notes
- [ ] `RGADocument` is a pure TypeScript class with zero UI dependencies

---

## User Scenarios & Testing

### User Story 1 — RGA Document Model (Priority: P1)

As a developer, I need a pure `RGADocument` class that manages a sequence of `CRDTChar`
objects so that collaborative edits can be applied, merged, and converged without a server
deciding the final order.

**Why this priority**: Everything else this week depends on a correct, isolated document model.
A bug here propagates into every subsequent feature.

**Independent Test**: Instantiate two `RGADocument` instances, apply the same set of
insert/delete operations in different orders, and assert both produce identical visible text.

**Acceptance Scenarios**:

1. **Given** an empty `RGADocument`, **When** `localInsert(0, 'A', 'client1')` is called,
   **Then** `getText()` returns `'A'` and the internal array has one non-tombstoned char.

2. **Given** a document with `['H','i']`, **When** `localDelete(1)` is called,
   **Then** `getText()` returns `'H'` and the deleted char remains as a tombstone.

3. **Given** two clients that both insert at position 0 simultaneously,
   **When** each applies the remote op from the other,
   **Then** both documents converge to the same two-character string (tie-broken by ID).

4. **Given** client A deletes a character while client B concurrently inserts after it,
   **When** both ops are applied on each side,
   **Then** neither document corrupts and both agree on the final visible text.

5. **Given** the same `remoteInsert` op is applied twice,
   **Then** the duplicate is silently ignored and the document is unchanged.

---

### User Story 2 — Lamport Clock (Priority: P1)

As a developer, I need a `LamportClock` that advances on local events and synchronises on
receipt of remote events so that every character ID is globally ordered and unique.

**Why this priority**: The clock is the tiebreaker for concurrent inserts at the same origin.
Without it, tie-breaking is undefined and convergence is not guaranteed.

**Independent Test**: Advance one clock to tick 5, call `update(5)` on a second clock —
assert the second clock's next `tick()` returns 6.

**Acceptance Scenarios**:

1. **Given** a fresh `LamportClock`, **When** `tick()` is called three times,
   **Then** the returned values are `1`, `2`, `3` in order.

2. **Given** a clock at `t=3`, **When** `update(7)` is called,
   **Then** the next `tick()` returns `8` (`max(3,7) + 1`).

3. **Given** two clocks both at `t=1`, **When** both call `tick()`,
   **Then** resulting IDs differ because clientId differentiates them.

---

### User Story 3 — CodeMirror 6 Integration (Priority: P1)

As a user, I need the editor to intercept keystrokes, convert them to CRDT ops, broadcast
them over WebSocket, and apply incoming remote CRDT ops back to the editor so that I see
other users' changes in real time.

**Why this priority**: This is the visible proof that the CRDT works end-to-end.

**Independent Test**: Open two tabs in the same room. Type "X" in tab A and "Y" in tab B
simultaneously. Both tabs must show the same two-character string within 500 ms.

**Acceptance Scenarios**:

1. **Given** two tabs in the same room, **When** I type a character in tab A,
   **Then** the character appears in tab B's editor within one WebSocket round-trip.

2. **Given** both tabs connected, **When** I type at the same position simultaneously,
   **Then** both tabs converge to the same text within 500 ms.

3. **Given** a character is deleted in tab A, **When** the delete op arrives at tab B,
   **Then** the correct character is removed from tab B without visible corruption.

4. **Given** a large paste (100+ characters) in one tab,
   **Then** the full paste appears correctly in the other tab.

---

### User Story 4 — Wire Protocol Update (Priority: P1)

As a developer, I need the shared message types and server broadcast logic to carry CRDT ops
instead of raw text deltas so that clients exchange structured operations the CRDT engine can
process.

**Why this priority**: The existing `OpMessage.payload` is a raw text delta and cannot carry
`CRDTChar` metadata required for RGA convergence.

**Independent Test**: Send a `crdt-insert` message to the server; assert it is broadcast
unchanged to all other clients in the room.

**Acceptance Scenarios**:

1. **Given** a `crdt-insert` message arrives at the server,
   **Then** it is broadcast to every other client with the original payload intact.

2. **Given** a `crdt-delete` message arrives at the server,
   **Then** it is broadcast to every other client with the original `charId` intact.

3. **Given** a malformed CRDT message (missing `charId` on a delete),
   **Then** it is rejected without crashing the server or affecting other clients.

---

### Edge Cases

- Two clients insert at the exact same origin with the same Lamport tick — tie-broken by clientId lexicographic order.
- A `remoteDelete` arrives before the corresponding `remoteInsert` (out-of-order delivery) — the delete is held or ignored if char not yet present.
- A char's `originId` references a tombstoned char — the tombstone still anchors the origin pointer correctly.
- Paste of 200+ characters — all chars inserted in sequence; no batch-size limit.

---

## Requirements

### Functional Requirements

- **FR-001**: Each character MUST be represented as `{ id, value, originId, deleted }` with `id` in format `clientId:lamportClock`.
- **FR-002**: `localInsert(visiblePos, value, clientId)` MUST find the left neighbour in the visible sequence, generate an ID, integrate the char, and return it.
- **FR-003**: `integrateInsert` MUST resolve same-origin conflicts deterministically by sorting concurrent same-origin chars by their IDs lexicographically.
- **FR-004**: `localDelete(visiblePos)` MUST set `deleted = true` on the char and return it; the char MUST remain in the array.
- **FR-005**: `remoteInsert` and `remoteDelete` MUST be idempotent — re-applying an already-seen op MUST leave the document unchanged.
- **FR-006**: `LamportClock.tick()` MUST return an incrementing counter starting at 1.
- **FR-007**: `LamportClock.update(received)` MUST set the clock to `max(clock, received) + 1`.
- **FR-008**: `shared/src/index.ts` MUST export `CRDTInsertMessage`, `CRDTDeleteMessage`, and updated `AppMessage` union.
- **FR-009**: The server MUST broadcast `crdt-insert` and `crdt-delete` messages to all other room clients without modifying the payload.
- **FR-010**: On local CodeMirror transaction, each character change MUST produce one `localInsert` or `localDelete` call and one broadcast.
- **FR-011**: On receiving a remote CRDT message, the client MUST apply the op and dispatch a CodeMirror transaction to reflect the change.

### Key Entities

- **`CRDTChar`** (`shared/src/crdt.ts`): Immutable character node — `id`, `value`, `originId | null`, `deleted`.
- **`LamportClock`** (`shared/src/crdt.ts`): Logical clock — `tick()`, `update(received)`.
- **`RGADocument`** (`shared/src/crdt.ts`): Core CRDT document; pure TS, no UI deps.
- **`CRDTInsertMessage`** (`shared/src/index.ts`): Wire message carrying a new char.
- **`CRDTDeleteMessage`** (`shared/src/index.ts`): Wire message carrying a char deletion.
- **`useCRDT`** (`client/src/hooks/useCRDT.ts`): React hook bridging `RGADocument` ↔ CodeMirror.

---

## Success Criteria

- **SC-001**: Two tabs typing simultaneously converge to the same text within 500 ms of the last keystroke.
- **SC-002**: The document never contains duplicate characters after concurrent inserts.
- **SC-003**: A concurrent delete + insert near the same position does not corrupt visible text.
- **SC-004**: `RGADocument` unit tests pass for single insert, single delete, concurrent inserts (same origin), concurrent insert+delete, and idempotent remote apply.
- **SC-005**: No character is physically removed from the internal array (tombstones only).
- **SC-006**: A paste of 200 characters in one tab appears correctly in the other tab within 1 second.

---

## Assumptions

- Week 1 WebSocket transport is stable; only new message type routing is added.
- `clientId` is the per-connection `userId` UUID from Week 1.
- Tombstone GC is deferred to a future week.
- CodeMirror position mapping uses visible-index scan; cursor drift is a known carry-forward for Week 3.
- Multi-character pastes are sequences of individual `localInsert` calls.
- The server does not validate or persist CRDT ops in Week 2 — persistence is Week 3 scope.
- Undo/redo is out of scope.

---

## Dependencies

| Dependency | Note |
|-----------|------|
| `001-week1-foundation` | WebSocket transport, RoomManager, useWebSocket, CodeMirror mount |
| `@codemirror/state` (bundled) | `Transaction`, `ChangeSet`, `EditorState` |
| `vitest` ^1.0 (already in shared devDeps) | Unit tests for RGADocument |
| No new npm packages required | RGA implemented from scratch |

---

## Out of Scope (Week 2)

- Server-side op persistence (Week 3)
- Late-joiner catchup / initial document sync (Week 3)
- Presence cursors (Week 3)
- Auth / JWT (Week 5)
- Tombstone garbage collection
- Undo/redo
