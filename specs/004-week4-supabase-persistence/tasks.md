---
description: "Task list for Week 4 — Supabase Persistence & Event-Sourcing"
---

# Tasks: Week 4 — Supabase Persistence & Event-Sourcing

**Input**: Design documents from `specs/004-week4-supabase-persistence/`
**Prerequisites**: plan.md ✅, spec.md ✅, data-model.md ✅, contracts/websocket-protocol.md ✅

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Parallelizable — different files, no blocking dependencies
- **[US1]**: Server restart loses no data
- **[US2]**: New client sees full document on join
- **[US3]**: Snapshot optimization for large documents
- **[US4]**: Realtime subscription for multi-instance broadcast

---

## Phase 1: Setup

**Purpose**: Install the new dependency, create directory structure, add env config files.

- [ ] T001 Add `@supabase/supabase-js` to `server/package.json` and run `npm install` in `server/`
- [ ] T002 Create `server/src/db/` directory with empty stub files: `supabase.ts`, `operations.ts`, `schema.sql`
- [ ] T003 [P] Create `.env.example` at repo root documenting `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SNAPSHOT_INTERVAL`, `ENABLE_REALTIME_BROADCAST`
- [ ] T004 [P] Verify `server/.env` is listed in `.gitignore` — add if missing

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Supabase client singleton and full DB operations layer. Both P1 user stories depend on this entirely.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T005 Write `server/src/db/schema.sql` — DDL for `rooms`, `operations`, `snapshots` tables with indexes per data-model.md
- [ ] T006 Implement `server/src/db/supabase.ts` — export a singleton `supabase` client initialized with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `process.env`; assumes env vars already validated by T030 (do not throw here)
- [ ] T007 Implement `persistOp()` in `server/src/db/operations.ts` — upsert room row then insert into `operations`; extract clock from `char.id` for inserts; extract clock from the `charId` being deleted for delete ops using the same `parseInt(charId.split(':').at(-1) ?? '0', 10)` extraction (the charId encodes the original Lamport tick)
- [ ] T008 [P] Implement `loadOpsForRoom()` in `server/src/db/operations.ts` — query latest snapshot by `last_clock DESC LIMIT 1`, then query `operations` where `clock > lastClock` ordered by `clock ASC`; return `{ snapshot, ops }`
- [ ] T009 [P] Implement `maybeSaveSnapshot()` in `server/src/db/operations.ts` — when `opCount % SNAPSHOT_INTERVAL === 0`, serialize the server-side `RGADocument.chars` array (including tombstones) as JSON and insert into `snapshots.serialized_chars`; read `SNAPSHOT_INTERVAL` from env (default `100`)
- [ ] T010 [P] Write unit tests in `server/src/db/operations.test.ts` — mock Supabase client; cover `persistOp` insert, `persistOp` delete, `loadOpsForRoom` with no snapshot, `loadOpsForRoom` with snapshot returning only delta ops
- [ ] T010a Add `loadFromChars(chars: CRDTChar[]): void` method to `RGADocument` in `shared/src/crdt.ts` — replaces the internal `chars[]` array with the provided deserialized array (allows client to restore full CRDT state from a snapshot without replaying every op); write unit test: call `loadFromChars` with a known chars array, assert `getText()` returns the correct visible text

**Checkpoint**: DB layer complete — user story implementation can now begin.

---

## Phase 3: User Story 1 — Server Restart Doesn't Lose Work (Priority: P1) 🎯 MVP

**Goal**: Every `crdt-insert` and `crdt-delete` is persisted before broadcast; server-side RGADocument tracks room state for snapshot generation.

**Independent Test**: Start a room, type 10+ characters, kill the server process (`Ctrl+C`), restart it (`npm run dev` in `server/`), reconnect — query Supabase `operations` table and confirm all rows are present.

- [ ] T011 Add `documents: Map<string, RGADocument>` to `server/src/room-manager.ts` — store a server-side `RGADocument` per room; initialize on first client join
- [ ] T012 [P] Add `opCount: Map<string, number>` to `server/src/room-manager.ts` — add `incrementOpCount(roomId): number` and `getOpCount(roomId): number` methods
- [ ] T013 [P] Add `seedOpCount(roomId: string, count: number): void` to `server/src/room-manager.ts` — called once per room from the catch-up load result to seed from DB
- [ ] T014 Update `server/src/index.ts` message handler — for `crdt-insert` and `crdt-delete`, call `await persistOp(roomId, client.id, msg)` before `roomManager.broadcast()`; if `persistOp` throws, log error and return without broadcasting
- [ ] T015 Update `server/src/index.ts` — after persist, apply op to server-side `RGADocument` via `roomManager.documents.get(roomId)?.remoteInsert(char)` / `remoteDelete(charId)` 
- [ ] T016 Update `server/src/index.ts` — after apply, call `roomManager.incrementOpCount(roomId)` then `await maybeSaveSnapshot(roomId, doc, count)` where `doc.getText()` is the snapshot content

**Checkpoint**: Kill server after typing, restart, check Supabase dashboard — all rows present. US1 verified.

---

## Phase 4: User Story 2 — New Client Sees Full Document on Join (Priority: P1)

**Goal**: Joining clients receive a `catchup` message with full document history before live ops stream; client replays it to reconstruct the document.

**Independent Test**: Load room in tab A, type a paragraph (~20 chars), close tab A entirely, open a fresh tab B on the same URL — tab B shows the full paragraph without tab A.

- [ ] T017 Add `CatchupMessage` interface to `shared/src/index.ts` — type `'catchup'`, fields: `roomId`, `userId`, `snapshot: { content: string; lastClock: number } | null`, `ops: Array<{ op_type: string; payload: object; clock: number }>`
- [ ] T018 Update `server/src/index.ts` `wss.on('connection')` — after sending `welcome`, call `loadOpsForRoom(roomId)`, seed `opCount` via `roomManager.seedOpCount()`, initialize server-side `RGADocument` by replaying loaded ops, then send `{ type: 'catchup', roomId, userId: client.userId, snapshot, ops }` to the joining client
- [ ] T019 Update `server/src/index.ts` — initialize server-side `RGADocument` on join: if room has no existing doc, create `new RGADocument('server')` and apply all catch-up ops to it (depends on T018 fetch result — NOT parallelizable)
- [ ] T020 Update `client/src/hooks/useCRDT.ts` `applyRemoteOp` — add `else if (type === 'catchup')` branch: if `msg.snapshot` is non-null, call `doc.loadFromChars(msg.snapshot.chars)` to restore full CRDT state, then replay each op in `msg.ops` via `doc.remoteInsert` / `doc.remoteDelete`, then sync editor view to `doc.getText()` (depends on T010a being merged first)
- [ ] T021 Write unit test in `shared/src/crdt.test.ts` — **catch-up replay convergence**: build an `RGADocument`, apply 20 insert ops, serialize ops array, create a fresh `RGADocument`, replay the serialized ops via `remoteInsert`, assert `getText()` equals the original
- [ ] T022 [P] Write unit test in `shared/src/crdt.test.ts` — **idempotent catch-up**: apply the same 20 ops twice to a single `RGADocument`; assert `getText()` is identical to applying them once
- [ ] T035 [US2] Write integration test in `server/src/catchup.integration.test.ts` — **catch-up/live-stream boundary** (SC-004): persist N ops for a room, start a `loadOpsForRoom` query, then insert one more live op while the query is in-flight; assert that a client reconstructed from the catch-up batch plus the live op has a final `getText()` that equals the source document with no duplicate or missing characters; this is the only direct verification of SC-004

**Checkpoint**: Close tab A, open tab B on same room — full document visible. US1 + US2 verified end-to-end.

---

## Phase 5: User Story 3 — Snapshot Optimization (Priority: P2)

**Goal**: After 100 ops, a snapshot is written; new-client catch-up loads snapshot + delta only.

**Independent Test**: Generate 200+ ops (type continuously), open Supabase dashboard, verify a row exists in `snapshots`; open a fresh tab, verify `catchup` message has non-null `snapshot` and `ops.length < 200`.

- [ ] T023 Write unit test in `server/src/db/operations.test.ts` — **snapshot threshold**: call `maybeSaveSnapshot` with `opCount=100`, assert Supabase insert called with `serialized_chars` containing a non-empty JSON array; call with `opCount=99`, assert not called; call with `opCount=200`, assert called
- [ ] T024 [P] Write unit test in `server/src/db/operations.test.ts` — **loadOpsForRoom with snapshot**: mock snapshot row at `lastClock=100`, mock 50 ops with `clock > 100`; assert result has `snapshot.lastClock=100` and `ops.length=50`
- [ ] T025 [P] Manual verification script in `server/src/db/` — add `seed-ops.ts` script that programmatically inserts 150 test ops for a room to trigger snapshot; run once to verify snapshot table populates

**Checkpoint**: 100+ ops in a room → `snapshots` table has a row → fresh join uses snapshot + delta. US3 verified.

---

## Phase 6: User Story 4 — Realtime Subscription for Multi-Instance Broadcast (Priority: P2)

**Goal**: Opt-in Supabase Realtime subscription per room — when `ENABLE_REALTIME_BROADCAST=true`, ops broadcast through DB events rather than direct socket calls.

**Independent Test**: Set `ENABLE_REALTIME_BROADCAST=true`, observe server logs for Realtime subscription start message when a client joins; op delivery still works correctly.

- [ ] T026 Add `realtimeSubs: Map<string, ReturnType<typeof supabase.channel>>` to `server/src/room-manager.ts`
- [ ] T027 Add `subscribeRoom(roomId: string, onOp: (op: object) => void): void` to `server/src/room-manager.ts` — creates a `supabase.channel` subscribing to `postgres_changes` INSERT events on `operations` for `room_id=eq.${roomId}`; logs subscription start
- [ ] T028 [P] Add `unsubscribeRoom(roomId: string): void` to `server/src/room-manager.ts` — removes and unsubscribes the channel; logs unsubscription; called from `leave()` when room becomes empty
- [ ] T029 Update `server/src/index.ts` — gate on `process.env['ENABLE_REALTIME_BROADCAST'] === 'true'`; on first client join (room was empty before), call `roomManager.subscribeRoom(roomId, (op) => roomManager.broadcast(roomId, op))`; on room empty in `ws.on('close')`, call `roomManager.unsubscribeRoom(roomId)`

**Checkpoint**: With `ENABLE_REALTIME_BROADCAST=true`, server logs show subscription; ops still delivered to clients. US4 verified.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Observability, env validation, TypeScript correctness, and manual verification.

- [ ] T030 Add startup env var validation to `server/src/index.ts` — before creating HTTP/WebSocket server, check `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are non-empty; `console.error` and `process.exit(1)` if missing
- [ ] T031 [P] Audit all DB calls in `server/src/db/operations.ts` — confirm every `try/catch` block logs at `[db]` prefix with operation name and roomId
- [ ] T032 [P] Confirm catch-up log line in `server/src/index.ts` — `[room:${roomId}] catch-up sent — ${ops.length} ops, snapshot=${snapshot !== null}` logged after send
- [ ] T033 [P] Run TypeScript compilation: `cd server && npx tsc --noEmit` — resolve all type errors introduced by Week 4 changes
- [ ] T034 [P] Run existing test suite: `cd shared && npm test` — confirm Week 3 CRDT tests still pass; confirm new Week 4 tests pass

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)
    └── Phase 2 (Foundational DB Layer)
            ├── Phase 3 (US1 — Op Persistence + Server CRDT)
            │       └── Phase 4 (US2 — Catch-up Delivery)  ← US1 must exist for US2 to have data
            ├── Phase 5 (US3 — Snapshots)                  ← Can start after Phase 3 T009 exists
            └── Phase 6 (US4 — Realtime)                   ← Independent of US1/US2/US3
Phase 7 (Polish)  ← Depends on all user story phases
```

### User Story Dependencies

- **US1 (P1)**: Depends on Phase 2. No dependency on other stories.
- **US2 (P1)**: Depends on US1 (needs persisted ops to serve). Start after Phase 3 T014 complete.
- **US3 (P2)**: Depends on Phase 2 (`maybeSaveSnapshot` exists). Start after Phase 3 T016 (needs `opCount`).
- **US4 (P2)**: Depends on Phase 1 (Supabase client). Independent of US1/US2/US3.

### Parallel Opportunities Per Story

**Phase 2** (after T005+T006 complete): T007, T008, T009, T010 can run in parallel  
**Phase 3** (after T011 starts): T012, T013 can run in parallel with T011  
**Phase 4** (after T017 complete): T018, T019 can run together; T021, T022 can run together  
**Phase 5** (after T009 exists): T023, T024, T025 can all run in parallel  
**Phase 6** (after T026 starts): T027, T028 can run in parallel  
**Phase 7**: T031, T032, T033, T034 can all run in parallel after T030

---

## Implementation Strategy

**MVP** = Phase 1 + Phase 2 + Phase 3 + Phase 4 (US1 + US2)  
These are the only tasks needed to satisfy SC-001 (no data loss on restart) and SC-002 (new client sees full document).  
Run the end-of-week check after completing MVP before starting US3/US4.

**End-of-Week Check** (from spec):
- [ ] Server restart doesn't lose any document state → verified by SC-001
- [ ] A brand-new tab joining sees the full current document → verified by SC-002
- [ ] Snapshot logic reduces replay cost for 100+ op rooms → verified after US3 (Phase 5)
- [ ] Can explain event-sourcing + snapshot+delta architecture out loud → verified by review

**Total tasks**: 36 (T010a and T035 added by consistency remediation)
**MVP tasks** (Phase 1–4): T001–T022 + T010a + T035 = 24 tasks
**Optimization** (Phase 5): T023–T025 = 3 tasks
**Architecture demo** (Phase 6): T026–T029 = 4 tasks
**Polish** (Phase 7): T030–T034 = 5 tasks
