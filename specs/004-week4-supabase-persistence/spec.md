# Feature Specification: Week 4 — Supabase Persistence & Event-Sourcing

**Feature Branch**: `004-week4-supabase-persistence`
**Created**: 2026-07-20
**Status**: Draft
**Input**: User description: "Week 4 - Supabase persistence and event-sourcing for CRDT collaborative editor"

## Overview

Add durable persistence to the collaborative editor using an event-sourcing approach backed by Supabase. Every CRDT operation is appended to an immutable operations log. The current document state is derived by replaying that log. This enables server restarts without data loss, new clients joining mid-session to see the full document, and horizontal scalability through a shared database rather than in-memory server state.

**Core mental model**: The operations table IS the document. Rows are never updated — only inserted. Current state = replay everything from position 0 to now.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Server Restart Doesn't Lose Work (Priority: P1)

A developer is editing a document in a room. The server process restarts (deploy, crash, etc.). After reconnecting, the document is exactly where it was — no content is lost.

**Why this priority**: This is the foundational guarantee of event-sourcing. Without it, the feature has no value. Everything else builds on this.

**Independent Test**: Start a room, type several paragraphs, kill the server process, restart it, reconnect — document content is fully intact.

**Acceptance Scenarios**:

1. **Given** a room has 10+ operations persisted, **When** the server process is killed and restarted, **Then** in-memory document state is reconstructed from the operations log on startup
2. **Given** a client reconnects after a server restart, **When** the client joins the room, **Then** it receives the full reconstructed document with no missing operations
3. **Given** a client was mid-edit when the server died, **When** the server restarts and the client reconnects, **Then** any ops that were persisted before the crash are present in the document

---

### User Story 2 — New Client Sees Full Document on Join (Priority: P1)

A second user opens a room URL that already has content. Without any collaboration from existing users, they immediately see the full current document — not a blank editor.

**Why this priority**: Equally foundational. Collaborative editing is useless if latecomers see an empty document.

**Independent Test**: Load room in tab A, type a paragraph, close tab A entirely, open a fresh tab B on the same room URL — tab B shows the full paragraph with no interaction from tab A.

**Acceptance Scenarios**:

1. **Given** a room has an established document with 50+ operations, **When** a brand-new client joins the room, **Then** it receives the full current document state before the editor renders
2. **Given** a room has been idle for hours with persisted operations, **When** a client joins, **Then** document loads correctly with no stale or corrupted state
3. **Given** a catch-up replay is in progress, **When** new live operations arrive simultaneously, **Then** no operations are dropped or duplicated at the catch-up/live-stream boundary

---

### User Story 3 — Snapshot Optimization for Large Documents (Priority: P2)

After a room accumulates 100+ operations, replay performance stays consistent rather than growing linearly with document size.

**Why this priority**: Required for production viability but does not block the core persistence story.

**Independent Test**: Generate 200+ ops in a room, verify a snapshot is created, then verify a fresh join replays from the snapshot rather than from op #1.

**Acceptance Scenarios**:

1. **Given** a room reaches 100 operations, **When** the 100th op is persisted, **Then** a snapshot of the full document string is written to the snapshots store
2. **Given** a snapshot exists at clock N, **When** a new client joins, **Then** catch-up loads the snapshot first and only replays ops with clock > N
3. **Given** 250 total ops exist with a snapshot at op 200, **When** a client joins, **Then** it replays 50 ops (delta), not 250 ops

---

### User Story 4 — Real-Time Subscription for Multi-Instance Broadcast (Priority: P2)

The server broadcasts new operations to connected clients via database INSERT events, decoupling broadcast from direct server-instance knowledge.

**Why this priority**: Enables horizontal scalability — multiple server instances can serve the same room without peer communication. Not needed for local dev but architecturally significant.

**Independent Test**: Subscribe to database Realtime events in a second server instance; confirm it receives and re-broadcasts ops written by the first instance.

**Acceptance Scenarios**:

1. **Given** a server instance is subscribed to Realtime events for a room, **When** any server instance persists a new op, **Then** all subscribed instances receive the INSERT event
2. **Given** an INSERT event is received via Realtime, **When** the server processes it, **Then** it broadcasts the op to all WebSocket clients connected to that instance

---

### Edge Cases

- What happens if an op is persisted but the server crashes before broadcasting it? (Client reconnects and replays from catch-up — op is not lost)
- What happens if two ops arrive simultaneously with the same clock value? (Tie-breaking must be deterministic, per existing RGA CRDT logic)
- What happens if the catch-up batch and the live stream overlap at the boundary? (New ops arriving while catch-up is in-flight must not be replayed twice)
- What if the database connection is unavailable when an op arrives? (Op must not be broadcast without being persisted first — consistency over availability)
- What if snapshot creation fails? (Catch-up must still work by replaying all ops — snapshot is an optimization, not a hard dependency)

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST persist every CRDT operation to durable storage before or alongside broadcasting it to other clients
- **FR-002**: System MUST reconstruct full document state from the operations log on the first client join after server startup for each active room
- **FR-003**: When a client joins a room, system MUST deliver all persisted operations in clock order before allowing live operations to stream
- **FR-004**: System MUST prevent duplicate operation delivery at the catch-up/live-stream transition boundary
- **FR-005**: System MUST write a document snapshot after every 100 operations appended to a room
- **FR-006**: When a snapshot exists, catch-up MUST load the snapshot and replay only operations with clock greater than the snapshot clock
- **FR-007**: System MUST subscribe to database INSERT events on the operations store for each active room to enable multi-instance broadcast
- **FR-008**: Operations MUST be stored with: room identifier, client identifier, operation type, operation payload, logical clock value, and timestamp
- **FR-009**: Snapshots MUST be stored with: room identifier, the full serialized `CRDTChar[]` array (including tombstones) at snapshot time, and the clock value of the last included operation

### Key Entities

- **Room**: Collaborative session identified by a unique ID; has a name and creation timestamp
- **Operation**: Append-only record of a single CRDT event (insert or delete) tied to a room and client, carrying a logical clock value and serialized operation payload
- **Snapshot**: Periodic checkpoint of the full document string at a specific clock position, used to bound replay cost on new-client join

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A server process can be killed and restarted with zero document content loss — verified by comparing document state before and after restart
- **SC-002**: A brand-new client joining an existing room sees the full current document within 3 seconds of joining
- **SC-003**: For rooms with 100+ operations, a snapshot exists; a new-client join deserializes the snapshot's full CRDT state via `loadFromChars()` and replays only the delta ops since the snapshot clock — not the full operation history
- **SC-004**: No operation is delivered twice or missed at the catch-up/live-stream boundary — verified by generating concurrent ops during a fresh join and comparing final document state across clients
- **SC-005**: The system design supports multiple server instances serving the same room through the shared operations log — demonstrable by explaining the event-sourcing + Realtime subscription architecture

---

## Dependencies & Assumptions

- Supabase project is available with credentials accessible to the server; schema changes require database access during development
- Existing RGA CRDT logic (`remoteInsert`, `remoteDelete` — the public API on `RGADocument`) remains unchanged — persistence wraps around it, does not modify it
- Existing WebSocket message protocol is extended with a new `catchup` message type; all existing message types remain backward-compatible
- Clock values in the existing CRDT implementation are monotonically increasing and suitable for ordering operation replay
- Snapshot interval of 100 ops is a configurable constant
- The catch-up batch is sent as a single ordered array before the client's live stream begins — not interleaved
- Supabase Realtime is available in the Supabase tier in use
