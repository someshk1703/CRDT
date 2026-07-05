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

**Spec**: `specs/002-week2-crdt/spec.md` *(not yet created)*
**Branch**: `002-week2-crdt`

### Algorithm

- [ ] `CRDTChar` interface: `{ id, value, originId, deleted }` in `shared/src/crdt.ts`
- [ ] `RGADocument.localInsert(pos, value, clientId)` → returns `CRDTChar` to broadcast
- [ ] `RGADocument.integrateInsert(char)` — deterministic tie-break by `clientId`
- [ ] `RGADocument.localDelete(pos)` → returns charId to broadcast (tombstone, NOT splice)
- [ ] `RGADocument.toString()` → joins only non-deleted chars

### CodeMirror Integration

- [ ] `useCollabEditor` hook wires `EditorView` transactions → CRDT ops → WebSocket `send()`
- [ ] Remote CRDT ops received via WebSocket → applied to `RGADocument` → dispatched as CodeMirror transaction
- [ ] Bidirectional mapper: CRDT index (includes tombstones) ↔ CodeMirror visible index

### Tests (mandatory — constitution Principle IV)

- [ ] Unit tests in `shared/src/__tests__/crdt.unit.test.ts`:
  - [ ] Concurrent inserts at same position
  - [ ] Concurrent deletes
  - [ ] Insert after tombstone
  - [ ] 3-way merge
  - [ ] Idempotency (apply same op twice → same result)
- [ ] Convergence fuzz test in `shared/src/__tests__/crdt.convergence.test.ts`:
  - [ ] Generate random op sequences → apply in different orders on two `RGADocument` instances → same `toString()`

### Week 2 Gate — open Week 3 only when all items above are checked

---

## Week 3 — Presence (Live Cursors + Awareness)

**Spec**: `specs/003-week3-presence/spec.md` *(not yet created)*
**Branch**: `003-week3-presence`

- [ ] Presence message: `{ type: "presence", userId, cursor: { from, to }, name, color }`
- [ ] Server broadcasts presence to room (50ms debounce on client side)
- [ ] `presencePlugin` CodeMirror `ViewPlugin` renders cursor carets per remote user
- [ ] Selection range highlight (not just caret) via `Decoration.mark`
- [ ] Colour assigned on join (palette of 8, stable per session)
- [ ] `user-left` clears that user's cursor decoration immediately
- [ ] Cursor position reconciled after remote CRDT op shifts positions
- [ ] User list sidebar: connected users with initials + colour dot

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
