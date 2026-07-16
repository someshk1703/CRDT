# CRDT Collaborative Editor — Build Progress Checklist

Track end-of-week completion. Check off items only when verified end-to-end (not just committed).

---

## Week 1 — Foundation (Editor + WebSocket Skeleton)

**Spec**: [specs/001-week1-foundation/spec.md](specs/001-week1-foundation/spec.md)
**Tasks**: [specs/001-week1-foundation/tasks.md](specs/001-week1-foundation/tasks.md)
**Branch**: `001-week1-foundation`

### Infrastructure

- [x] Monorepo root `package.json` with npm workspaces (`client`, `server`, `shared`)
- [x] `tsconfig.base.json` with `strict: true`
- [x] `.gitignore`, `.env.example`, `.npmrc` (public registry)
- [x] `shared/` package with `AppMessage` union type
- [x] `npm install` from root — all workspace deps installed

### US1 — Monorepo + Project Skeletons

- [x] `npm run dev:server` starts and prints "listening on port 3001"
- [x] `npm run dev:client` opens Vite at `localhost:5173` with no console errors
- [x] `GET /health` returns `{ status: "ok", connections: 0, rooms: 0 }`

### US2 — CodeMirror 6 Editor

- [x] `localhost:5173/room/test` renders a CodeMirror editor with JavaScript syntax highlighting
- [x] Typing `const x = 1` applies token highlighting correctly
- [ ] **Learning checkpoint** — write one paragraph answering:
  - What does `EditorState` own?
  - What is a `Transaction` and when is one created?
  - Why will the CRDT hook into `Transaction` in Week 2?

### US3 — WebSocket Server + RoomManager

- [x] `RoomManager` uses `Map<roomId, Set<Client>>`
- [x] `broadcast()` skips sender and skips clients with `readyState !== OPEN`
- [x] Server validates `roomId` against `/^[a-z0-9-]{1,64}$/i`, closes with `1008` if invalid
- [x] Heartbeat: ping every 30s, terminate on no pong within 10s
- [x] 64 KB message size guard — oversized messages discarded
- [x] Rate limit: 50 ops/s per `clientId` (sliding window)
- [x] Verified with validation script: two clients same room → sender excluded from broadcast
- [x] `user-joined` event broadcast to existing peers on new connection
- [x] `user-left` event broadcast to peers on disconnect
- [x] RoomManager cleanup verified: connection count decreases after close

### US4 — `useWebSocket` Hook

- [x] Hook implemented with exponential backoff (1s, 2s, 4s… capped 30s)
- [x] `error` status surfaces after 5 consecutive failed attempts
- [x] UI shows "having trouble connecting…" warning in `error` state
- [x] Cleanup on unmount: `ws.close()` + cancel retry timer
- [ ] **Verified manually**: kill server → retry logs appear in console → `error` badge after 5 attempts
- [ ] **Verified manually**: restart server → hook reconnects → badge returns to `open`

### US5 — End-to-End Room Connection

- [x] Room isolation verified: tabs on `/room/aaa` and `/room/bbb` do NOT receive each other's broadcasts
- [ ] **Verified manually**: two tabs on `localhost:5173/room/abc123` — typing in tab A shows broadcast in tab B's log
- [ ] **Verified manually**: server logs show `[room:abc123] op from <id>` on each keystroke

### Cross-Cutting

- [x] `tsc --noEmit` clean in `/server`
- [x] `tsc --noEmit` clean in `/client`
- [x] `tsc --noEmit` clean in `/shared`
- [x] `@crdt/shared` types imported and used in `server/src/index.ts` and `useWebSocket.ts`

### Week 1 Gate — 19/19 automated checks pass ✅
> 4 manual browser items remain (reconnect backoff UI, two-tab live broadcast, learning checkpoint)

---

## Week 2 — CRDT Algorithm (RGA)

**Spec**: [specs/002-rga-crdt-core/spec.md](specs/002-rga-crdt-core/spec.md)
**Plan**: [specs/002-rga-crdt-core/plan.md](specs/002-rga-crdt-core/plan.md)
**Tasks**: [specs/002-rga-crdt-core/tasks.md](specs/002-rga-crdt-core/tasks.md)
**Branch**: `002-rga-crdt-core`

### Algorithm (`shared/src/crdt.ts`)

- [x] `CRDTChar` interface: `{ id, value, originId, deleted }` in `shared/src/crdt.ts`
- [x] `LamportClock`: `tick()`, `update(received)`, `now()`
- [x] `RGADocument.localInsert(pos, value, clientId)` → returns `CRDTChar` to broadcast
- [x] `RGADocument.integrateInsert(char)` — deterministic tie-break by ID lexicographic order
- [x] `RGADocument.localDelete(pos)` → tombstone (not splice), returns char for broadcasting
- [x] `RGADocument.remoteInsert(char)` — idempotent
- [x] `RGADocument.remoteDelete(charId)` — idempotent
- [x] `RGADocument.getText()` → joins only non-deleted chars
- [x] `RGADocument.getVisibleLength()` — count of non-tombstoned chars

### Wire Protocol

- [x] `CRDTInsertMessage` and `CRDTDeleteMessage` added to `shared/src/index.ts`
- [x] `CRDTChar` re-exported from shared package
- [x] `AppMessage` union includes both new types
- [x] Server routes `crdt-insert` / `crdt-delete` with payload validation

### CodeMirror Integration

- [x] `useCRDT` hook created in `client/src/hooks/useCRDT.ts`
- [x] Local CodeMirror transactions → CRDT ops → WebSocket broadcast
- [x] Remote CRDT ops → `RGADocument` → CodeMirror transaction dispatch
- [x] `remoteAnnotation` prevents re-broadcasting of applied remote ops
- [x] `Room.tsx` wired: Week 1 raw-op listener removed, broadcast log removed
- [x] `sendRef` pattern avoids hook-ordering dependency between `useCRDT` and `useWebSocket`

### Tests

- [x] Unit tests in `shared/src/crdt.test.ts` — **19/19 passing**:
  - [x] LamportClock tick sequence
  - [x] LamportClock update (max rule)
  - [x] Single insert, sequential inserts, insert in middle
  - [x] Tombstone delete (char remains in array)
  - [x] Remote insert idempotency
  - [x] Remote delete idempotency + unknown charId no-op
  - [x] Concurrent inserts → convergence (two-client cross-apply)
  - [x] Concurrent inserts after same origin → deterministic ordering
  - [x] Concurrent insert + delete → no corruption
  - [x] Three-client convergence

### TypeScript

- [x] `tsc --noEmit` clean in `shared/`
- [x] `tsc --noEmit` clean in `server/`
- [x] `tsc --noEmit` clean in `client/`

### Manual Convergence Tests (complete after running the app)

- [ ] Two tabs type simultaneously at position 0 → both converge to same 2-char string
- [ ] Delete in tab A + insert at same pos in tab B → no corruption
- [ ] Paste 50 chars in tab A → tab B shows all 50 chars
- [ ] Kill/restart server → reconnect works (Week 1 backoff still intact)

### Week 2 Gate — open Week 3 only when all items above are checked

---

## Week 3 — Presence (Live Cursors + Awareness)

**Spec**: [specs/003-week3-presence/spec.md](specs/003-week3-presence/spec.md)
**Tasks**: [specs/003-week3-presence/tasks.md](specs/003-week3-presence/tasks.md)
**Branch**: `003-week3-presence`

### Protocol & Server

- [x] `WelcomeMessage { type:'welcome', userId, roomId, color }` added to shared types
- [x] Server sends `welcome` to connecting client immediately on connect
- [x] Server tracks client's self-reported `userId` from received messages (`presenceUserId`)
- [x] `user-left` uses `presenceUserId` so peers can match it to their presence map
- [x] Server validates `presence` messages: cursor `from`/`to` are numbers, `name` ≤ 64 chars
- [x] Server relays `presence` messages to all peers (no server-side cursor state stored)
- [x] Colour palette: 8 colours, assigned round-robin per connection, stable for session

### Client — Presence Extension

- [x] `client/src/extensions/presenceCursors.ts` created
- [x] `updatePresenceEffect` StateEffect (add/remove cursor by userId)
- [x] `presenceField` StateField holds `ReadonlyMap<userId, PresenceState>`
- [x] `CursorWidget` — coloured 2px caret + floating name label (no DOM events)
- [x] `Decoration.mark` for selection ranges (25% bg, 60% bottom border)
- [x] `buildDecorations` clamps positions to `[0, doc.length]`; wrapped in try/catch
- [x] `ViewPlugin` rebuilds decorations only on `docChanged` or `updatePresenceEffect`

### Client — `usePresence` Hook

- [x] `client/src/hooks/usePresence.ts` created
- [x] Routes `welcome` → stores server-assigned colour
- [x] Routes `presence` → dispatches `updatePresenceEffect` (ignores own userId)
- [x] Routes `user-left` → dispatches null effect to remove cursor
- [x] `sendPresence` debounced at 50 ms — not sent on every keystroke
- [x] `reconcileCursors(from, removed, inserted)` adjusts all tracked cursors after CRDT ops
- [x] Mirror map (`presenceMapRef`) kept in sync with the StateField for reconciliation

### Client — `useCRDT` Integration (Week 3 additions)

- [x] `options.onRemoteChange?(from, removed, inserted)` callback added
- [x] `applyTextDiff` refactored to return `DiffResult | null` with `{from, removed, inserted}`
- [x] `applyRemoteOp` calls `onRemoteChange` after every remote op

### Client — `Room.tsx` Integration

- [x] `usePresence` integrated alongside `useCRDT`
- [x] Single `handleMessage` routes to both `applyRemoteOp` and `handlePresenceMessage`
- [x] `selectionListenerExtension` fires `sendPresence` on `selectionSet`
- [x] Both `setCrdtView` and `setPresenceView` called after editor mount
- [x] User identity pill ("User-XXXX") shown in header

### TypeScript

- [x] `tsc --noEmit` / `npm run build` clean in all workspaces

### Manual Acceptance Tests (complete after running the app)

- [ ] Two tabs see each other's carets with correct name and colour
- [ ] Tab A selects a range → Tab B shows highlighted range in Tab A's colour
- [ ] Tab B types before Tab A's cursor → Tab A's cursor shifts correctly (no drift)
- [ ] Close Tab A → Tab B's view of A's cursor disappears immediately
- [ ] Type 10 chars fast → browser DevTools Network shows ≤1 presence message per 50ms
- [ ] Answer: "What happens if a cursor points to a position a CRDT op just deleted?"
  - Answer: the cursor collapses to the insertion point (`from + inserted`) via `adjustPosition`

### Week 3 Gate — open Week 4 only when all items above are checked

---

## Week 4 — Persistence (Supabase + Event Sourcing)

**Spec**: `specs/004-week4-persistence/spec.md` *(not yet created)*
**Branch**: `004-week4-persistence`

- [ ] Supabase schema: `rooms(id, name, created_at)`, `operations(id, room_id, client_id, op_type, payload JSONB, clock, created_at)`, `snapshots(id, room_id, clock, content, created_at)`
- [ ] Every CRDT op persisted to `operations` table (append-only, never update)
- [ ] New client catch-up: load latest snapshot + replay ops after snapshot clock
- [ ] Supabase Realtime subscription on `operations INSERT` for multi-instance broadcast
- [ ] Snapshot triggered async every 100 ops (background `setInterval`, NOT inline with broadcast)
- [ ] Nightly cleanup job: delete `operations` rows older than the latest snapshot clock
- [ ] `.env.example` updated with `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- [ ] `server/.env` configured locally (not committed)

### Week 4 Gate — open Week 5 only when all items above are checked

---

## Week 5 — Auth, Rooms, Polished UX, Deployment

**Spec**: `specs/005-week5-auth/spec.md` *(not yet created)*
**Branch**: `005-week5-auth`

### Auth

- [ ] GitHub OAuth configured in Supabase dashboard
- [ ] `useSession()` hook on client; user redirected to login if no session
- [ ] JWT validated on WebSocket upgrade (NOT after connection accepted)
- [ ] JWT expiry handled: client refreshes token silently before reconnecting
- [ ] `userId` is now stable (derived from JWT `sub`), not per-connection random

### Rooms

- [ ] Room creation: generate nanoid slug, redirect to `/room/{slug}`
- [ ] Room list page shows user's recent rooms
- [ ] Room visibility: public (link only) vs private (invite required)
- [ ] Private rooms: `members` table, server-side check on join

### UX

- [ ] Language selector toolbar (Python, Java, etc.)
- [ ] Language change broadcasts `{ type: "language", lang }` to room
- [ ] Connected users count + avatar initials in header

### Deployment

- [ ] Frontend deployed to Vercel
- [ ] WebSocket server deployed to Railway (persistent process — NOT Vercel serverless)
- [ ] CORS: `Access-Control-Allow-Origin` set to Vercel origin (not `*`)
- [ ] Environment variables set in Railway dashboard (not committed)
- [ ] Live demo URL in README
- [ ] Demo GIF (10s, two windows, live cursors) at top of README

### Week 5 Gate — open Week 6 only when all items above are checked

---

## Week 6 — Bonus: Sandboxed Code Execution

**Spec**: `specs/006-week6-execution/spec.md` *(not yet created)*
**Branch**: `006-week6-execution`

- [ ] Separate execution microservice (not in main WebSocket server process)
- [ ] Docker: `--network=none`, `--memory=64m`, `--cpus=0.5`, read-only FS, non-root user
- [ ] Supported runtimes: `node:alpine`, `python:slim`
- [ ] 10-second timeout + memory cap enforced
- [ ] stdout/stderr streamed back via WebSocket as `{ type: "exec-output", chunk }` messages
- [ ] "Run" button in toolbar (disabled during execution, shows spinner)
- [ ] Security review: untrusted code NEVER runs in the main server process

### Week 6 Gate — project complete 🎉

---

## Overall Progress

| Week | Focus | Status |
|------|-------|--------|
| 1 | Foundation — WebSocket + CodeMirror | 🔄 In progress |
| 2 | CRDT — RGA algorithm | ⏳ Pending Week 1 gate |
| 3 | Presence — live cursors | ⏳ Pending Week 2 gate |
| 4 | Persistence — Supabase event log | ⏳ Pending Week 3 gate |
| 5 | Auth + rooms + deployment | ⏳ Pending Week 4 gate |
| 6 | Bonus — code execution sandbox | ⏳ Pending Week 5 gate |

---

*Update this file after each build session. The gate check before each week ensures Week N+1 never starts on a shaky Week N foundation.*
