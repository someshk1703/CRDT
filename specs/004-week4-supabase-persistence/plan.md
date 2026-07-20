# Implementation Plan: Week 4 — Supabase Persistence & Event-Sourcing

**Branch**: `004-week4-supabase-persistence` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/004-week4-supabase-persistence/spec.md`

---

## Summary

Add durable persistence to the CRDT collaborative editor using an event-sourcing approach backed by Supabase Postgres. Every CRDT operation is appended to an immutable `operations` table. Current document state is derived by replaying the log. On server restart, state is reconstructed from the DB. New clients joining an existing room receive a `catchup` message containing the full operation history (latest snapshot + delta ops) before live operations begin streaming.

**Core architectural change**: The `RoomManager` becomes a cache over the database rather than the source of truth. All writes go to Supabase first; the in-memory broadcast is additive, not primary.

---

## Technical Context

**Language/Version**: TypeScript 5.4, Node.js ESM modules
**Primary Dependencies**: `ws` (WebSocket server), `@supabase/supabase-js` v2 (new)
**Storage**: Supabase Postgres (managed) — 3 new tables: `rooms`, `operations`, `snapshots`
**Testing**: Vitest (unit), Playwright (E2E); new integration tests for catch-up and snapshot logic
**Target Platform**: Local Node.js dev server; Railway deployment target in Week 5
**Performance Goals**: Catch-up for 500-op room completes in < 1 second (snapshot + delta)
**Constraints**: DB write must succeed before broadcast (FR-001); no hardcoded secrets
**Scale/Scope**: Single room scenario for local dev; architecture supports multi-instance

---

## Constitution Check

### Principle I — Incremental Build Discipline

- [x] Spec exists with prioritized user stories (P1: server restart, new client join; P2: snapshots, Realtime)
- [x] All stories have Given-When-Then acceptance criteria
- [x] No NEEDS CLARIFICATION markers remain
- [x] P1 stories (persistence + catch-up) can be built and verified before P2 stories (snapshots, Realtime)
- [x] Week 3 behavior (presence, heartbeat, rate-limit) is fully preserved — persistence is additive

### Principle II — CRDT Algorithm Correctness

- [x] `RGADocument` code is NOT modified — persistence wraps around it
- [x] `remoteInsert` idempotency is relied upon to handle catch-up/live-stream boundary race
- [x] Catch-up replay applies ops in clock order (ascending) to guarantee convergence
- [x] Tie-breaking in concurrent inserts remains unchanged (lexicographic by ID)

### Principle III — WebSocket & Connection Reliability

- [x] New `catchup` message is sent AFTER `welcome`, before live ops — client always has context before editing
- [x] Existing reconnect/heartbeat/rate-limit logic is unchanged
- [x] Supabase client failure does not crash the WebSocket server — errors are caught and logged
- [x] `SUPABASE_SERVICE_ROLE_KEY` never hardcoded; loaded from environment variables

### Principle IV — Testing Standards

- [x] Unit tests for `persistOp`, `loadOpsForRoom`, `maybeSaveSnapshot` (mock Supabase client)
- [x] Unit test: catch-up replay from snapshot + delta produces correct document
- [x] Unit test: snapshot trigger fires at op count multiples of 100
- [x] Integration test: kill server, restart, verify document state restored
- [x] Integration test: two tabs — close tab A, open tab B, verify full document visible
- [x] E2E boundary test: generate live ops during catch-up, verify no duplicates or drops

### Principle V — Observability & Traceability

- [x] All DB operations log success/failure at `[db]` prefix
- [x] Catch-up delivery logged: `[room:${id}] catch-up sent — ${ops.length} ops, snapshot=${!!snapshot}`
- [x] Snapshot writes logged: `[room:${id}] snapshot written at clock ${lastClock}`
- [x] Supabase Realtime subscription start/stop logged per room
- [x] Env var validation on startup: error and exit if `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` missing

---

## Phase 0: Research & Decisions

### Decision 1: Supabase Client Library

**Decision**: `@supabase/supabase-js` v2 (official JS client)
**Rationale**: Native TypeScript types, built-in Realtime support, service-role auth for server-side bypass of Row Level Security. Alternative (raw `pg` driver) was considered but lacks Realtime integration.
**Usage**: Server-side only with `SUPABASE_SERVICE_ROLE_KEY`. Client browser never touches Supabase directly.

### Decision 2: Clock Extraction Strategy

**Decision**: Extract Lamport tick from the `char.id` field (format: `"clientId:lamportTick"`) at persist time
**Rationale**: The ID format is already defined in `crdt.ts` (`\`${clientId}:\${this.clock.tick()}\``). Extracting the tick at write time avoids storing derived data separately and keeps the DB schema clean.
**Implementation**: `parseInt(charId.split(':').at(-1) ?? '0', 10)`

### Decision 3: Catch-up Boundary Handling

**Decision**: Rely on `remoteInsert`/`remoteDelete` idempotency; no additional synchronization
**Rationale**: `RGADocument.remoteInsert` already silently ignores duplicate IDs (existing production behavior). An op that appears in both the catch-up batch and as a live broadcast is applied once and ignored the second time. No buffering, sequence numbers, or client-side deduplication state needed.
**Trade-off**: A client may briefly render a partial document (live op before catch-up arrives). This is a cosmetic ordering issue; convergence is guaranteed.

### Decision 4: Op Count for Snapshot Trigger

**Decision**: Track op count per room in `RoomManager` (in-memory `Map<roomId, number>`), seeded from `COUNT(*)` query on first room join
**Rationale**: Avoids a `COUNT` query on every insert (expensive for large rooms). Seed once on first join; increment in-memory. Acceptable to be slightly inaccurate after a server restart (worst case: snapshot fires a few ops early/late — harmless).
**Alternative**: Query `COUNT(*)` on every insert — rejected as too expensive for hot path.

### Decision 5: Realtime Subscription Strategy

**Decision**: Add Realtime subscription alongside direct broadcast, controlled by `ENABLE_REALTIME_BROADCAST=true` env var (defaults to `false`)
**Rationale**: For local dev, direct broadcast is zero-latency and simpler. Realtime subscription adds a DB round-trip (~10-50ms). The subscription is the correct production architecture for multi-instance deployments. Keeping it opt-in avoids breaking local dev performance.
**Interview talking point**: "In production, we'd set `ENABLE_REALTIME_BROADCAST=true`. Each server instance subscribes to INSERT events on the operations table for each active room. When a new op lands — regardless of which instance wrote it — all subscribed instances receive the event and broadcast to their connected WebSocket clients. This is what makes horizontal scaling possible without server-to-server coordination."

---

## Phase 1: Design Artifacts

All artifacts are in `specs/004-week4-supabase-persistence/`:

| Artifact | Path | Status |
|----------|------|--------|
| Data Model | [data-model.md](./data-model.md) | ✅ Complete |
| WebSocket Contracts | [contracts/websocket-protocol.md](./contracts/websocket-protocol.md) | ✅ Complete |
| System Architecture | [diagrams/system-architecture.md](./diagrams/system-architecture.md) | ✅ Complete |
| Data Flow | [diagrams/data-flow.md](./diagrams/data-flow.md) | ✅ Complete |

---

## Implementation Sequence

### Stage 1: Infrastructure (P1 prerequisite)

**Goal**: Supabase client wired up, tables created, `persistOp` working end-to-end.

**Files to create**:
- `server/src/db/supabase.ts` — Supabase client singleton
- `server/src/db/operations.ts` — `persistOp`, `loadOpsForRoom`, `maybeSaveSnapshot`
- `server/src/db/schema.sql` — Full DDL for `rooms`, `operations`, `snapshots`
- `.env.example` — document required env vars

**Files to update**:
- `server/package.json` — add `@supabase/supabase-js`

**Verification**: Type a few characters in a room, query `operations` table in Supabase dashboard — confirm each keystroke is a row.

---

### Stage 2: Op Persistence on Message (P1)

**Goal**: Every `crdt-insert` and `crdt-delete` that reaches the server is persisted before broadcast.

**Files to update**:
- `server/src/index.ts` — call `persistOp()` in the `ws.on('message')` handler before `roomManager.broadcast()`
- `server/src/room-manager.ts` — add `opCount: Map<string, number>` field; `incrementOpCount(roomId)` method

**Invariant**: If `persistOp()` throws, the op is NOT broadcast. Log the error and return.

**Clock extraction**: Both inserts and deletes use `parseInt(id.split(':').at(-1) ?? '0', 10)`. For inserts, `id = char.id`. For deletes, `id = charId` (the ID of the character being deleted — it encodes the original Lamport tick).

**Test**: Kill server after 10 keystrokes, query Supabase — all 10 rows present.

---

### Stage 3: Server Restart Reconstruction (P1)

**Goal**: On server startup, all persisted ops for active rooms are available for catch-up. No active step needed at startup — rooms are reconstructed lazily on first join.

**Note**: Because rooms are reconstructed on demand (first join triggers `loadOpsForRoom`), no explicit startup reconstruction loop is needed. The first client to join a room after restart will trigger the catch-up flow and receive the full document.

---

### Stage 4: New Client Catch-up (P1)

**Goal**: Joining clients receive full document state via `catchup` message.

**Files to update**:
- `server/src/index.ts`:
  - On `wss.on('connection')`, after sending `welcome`, call `loadOpsForRoom(roomId)` and send `catchup`
  - Seed `opCount` in `RoomManager` from loaded op count
- `shared/src/index.ts` — add `CatchupMessage` interface (the `catchup` type already exists in `MessageType`)
- `client/src/hooks/useCRDT.ts` — handle `type === 'catchup'` in `applyRemoteOp`: replay snapshot then ops

**Client catch-up implementation sketch**:
```typescript
if (type === 'catchup') {
  const msg = parsed as CatchupMessage;
  const doc = docRef.current;
  const view = viewRef.current;
  if (!view) return;
  
  // 1. Apply snapshot content directly (set full text, bypass CRDT)
  if (msg.snapshot) {
    // Reset doc and set text (requires new RGADocument or bulk load)
  }
  
  // 2. Replay delta ops in order
  for (const op of msg.ops) {
    if (op.op_type === 'insert') {
      doc.remoteInsert(op.payload as CRDTChar);
    } else {
      doc.remoteDelete((op.payload as { charId: string }).charId);
    }
  }
  
  // 3. Sync editor view
  const newText = doc.getText();
  applyTextDiff(view, '', newText); // or replace full document
}
```

**Test**: Load room in tab A, type a paragraph, close tab A entirely, open fresh tab B — tab B shows full paragraph.

---

### Stage 5: Snapshot Creation (P2)

**Goal**: Every 100th op triggers a snapshot write.

**Files to update**:
- `server/src/index.ts` — after `persistOp()` and `incrementOpCount()`, call `maybeSaveSnapshot(roomId, currentDoc, opCount)`
- `server/src/room-manager.ts` — expose `getOpCount(roomId)` and in-memory CRDT document per room

**Design note**: The server needs to maintain an in-memory `RGADocument` per room to generate snapshots. `RoomManager` already tracks rooms; add a `documents: Map<roomId, RGADocument>` map. On message receipt (insert/delete), apply the op to the server-side doc. Snapshot = serialize the full `doc.chars` array (including tombstones) as JSON. Storing the complete CRDT state (not just visible text) is essential so that delta ops replayed during catch-up can correctly resolve `originId` references that span pre-snapshot history.

**Test**: Generate 200+ ops, verify `snapshots` table has a row with non-empty `serialized_chars`; verify a fresh join has `snapshot.chars.length > 0` and `ops.length < 200`.

---

### Stage 6: Supabase Realtime (P2)

**Goal**: Opt-in Realtime subscription per room for multi-instance broadcast.

**Files to update**:
- `server/src/room-manager.ts` — add `realtimeSubs: Map<roomId, RealtimeChannel>`; `subscribeRoom(roomId)` and `unsubscribeRoom(roomId)` methods
- `server/src/index.ts` — call `subscribeRoom(roomId)` on first client join (when room is new); `unsubscribeRoom(roomId)` when room becomes empty; gated by `ENABLE_REALTIME_BROADCAST` env var

**Test**: With `ENABLE_REALTIME_BROADCAST=true`, confirm ops from a simulated second server path arrive via the subscription callback.

---

## Testing Plan

### Unit Tests (`server/src/db/operations.test.ts`)

| Test | What it verifies |
|------|-----------------|
| `persistOp` — insert | Calls Supabase insert with correct `op_type='insert'` and serialized payload |
| `persistOp` — delete | Calls Supabase insert with correct `op_type='delete'` |
| `loadOpsForRoom` — no snapshot | Returns `{snapshot: null, ops: all_ops}` |
| `loadOpsForRoom` — with snapshot | Returns `{snapshot: {...}, ops: delta_only}` |
| `maybeSaveSnapshot` — at threshold | Serializes `doc.chars` array as JSONB and calls Supabase insert when `opCount % 100 === 0` |
| `maybeSaveSnapshot` — not at threshold | Does not insert when `opCount % 100 !== 0` |

### Integration Tests (`server/src/catchup.integration.test.ts`)

| Test | What it verifies |
|------|-----------------|
| Server restart recovery | Persist 10 ops, simulate restart, rejoin — all 10 ops in catch-up |
| Snapshot + delta catch-up | 150 ops total, snapshot at 100 — catch-up sends snapshot + 50 delta ops |
| Boundary safety | Send live op concurrently with catch-up; final doc state matches source |

### E2E Tests (`shared/src/crdt.test.ts` additions)

| Test | What it verifies |
|------|-----------------|
| Catch-up replay convergence | Apply ops in catch-up order; compare `getText()` to original document |
| Idempotent replay | Apply catch-up ops + same ops again; no corruption |

---

## Quickstart

### 1. Supabase Setup

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. In the SQL editor, run `server/src/db/schema.sql`
3. Copy your project URL and service role key

### 2. Environment Variables

```bash
# server/.env (gitignored)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SNAPSHOT_INTERVAL=100
ENABLE_REALTIME_BROADCAST=false
```

### 3. Install Dependencies

```bash
cd server && npm install @supabase/supabase-js
```

### 4. Run

```bash
# From repo root
npm run dev   # starts both client (Vite) and server (tsx watch)
```

### 5. Verify

- Open `http://localhost:5173/room/test-room`
- Type several characters
- Query Supabase dashboard → Table Editor → `operations` — confirm rows
- Kill and restart the server
- Reconnect — document intact

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Supabase free tier rate limits during dev | Low | Medium | Operations table writes are low-volume during development |
| Catch-up payload too large for WebSocket (>64 KB limit) | Low | High | For very large rooms, chunk catch-up batches; increase `MAX_MESSAGE_BYTES` for catch-up only |
| Server-side `RGADocument` diverges from clients | Medium | High | Unit test: apply same ops to server doc and client doc; assert `getText()` is equal |
| Env vars missing at startup | High in fresh env | Low | Validate on startup; log clear error and exit |
| Realtime subscription accumulates after room empties | Low | Low | Unsubscribe in `leave()` when room size hits zero |
