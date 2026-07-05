# Tasks: Week 1 — Foundation (Editor + WebSocket Skeleton)

**Feature**: `001-week1-foundation`
**Generated**: 2026-07-05
**Source**: spec.md (plan.md not yet created)
**Tech Stack**: TypeScript 5 (strict) · React 18 · Vite 4 · CodeMirror 6 · Node.js + `ws`

---

## Summary

| Phase | Scope | Tasks | [P] Opportunities |
|-------|-------|-------|-------------------|
| 1 — Setup | Monorepo root config | T001–T005 | T002–T005 in parallel |
| 2 — Foundational | Shared types package | T006–T008 | T007–T008 in parallel |
| 3 — US1 | Client + server scaffolding | T009–T016 | T010+T012 parallel, T011+T013+T014+T015 parallel |
| 4 — US2 | CodeMirror 6 editor | T017–T020 | T019+T020 in parallel |
| 5 — US3 | WebSocket server + RoomManager | T021–T022e | T021+T022a in parallel |
| 6 — US4 | `useWebSocket` hook | T023 | — |
| 7 — US5 | End-to-end room connection | T024–T027 | none (all modify Room.tsx) |
| 8 — Polish | TypeScript checks + smoke tests | T028–T031 | T028+T029+T030a in parallel |

**Total tasks**: 36

> *(Remediation applied 2026-07-05: A1 T022 split, I1 [US2] labels, I2 [P] conflict, C1 shared tsc, C2 client guard, D1 count, D2 T005 parallel)*
**Suggested MVP scope**: Complete Phase 1 → Phase 3 → verify US1 checklist, then proceed

---

## Phase 1 — Setup

> Goal: Root monorepo infrastructure in place. `npm install` from root installs all workspaces.

- [ ] T001 Create root package.json with npm workspaces `["client","server","shared"]` and `dev:client`, `dev:server` scripts in package.json
- [ ] T002 [P] Create tsconfig.base.json with `strict: true`, `esModuleInterop`, `skipLibCheck` in tsconfig.base.json
- [ ] T003 [P] Create .gitignore ignoring `node_modules/`, `dist/`, `.env`, `.adt/`, `.specify/`, `.npmrc` in .gitignore
- [ ] T004 [P] Create .env.example documenting all server environment variables (PORT, SUPABASE_URL placeholder, JWT_SECRET placeholder) in .env.example
- [ ] T005 [P] Create .npmrc pointing to public npm registry (`registry=https://registry.npmjs.org/`) in .npmrc

---

## Phase 2 — Foundational (Shared Package)

> Goal: Pure-TypeScript shared package with message types importable by both client and server.
> MUST complete before US3 (server) and US4 (client hook) begin.

- [ ] T006 Create shared/package.json with `"type": "module"`, exports pointing to `./src/index.ts`, vitest devDependency in shared/package.json
- [ ] T007 [P] Create shared/tsconfig.json extending `../tsconfig.base.json` with `"module": "NodeNext"` in shared/tsconfig.json
- [ ] T008 [P] Define `AppMessage` union type (`OpMessage`, `PresenceMessage`, `UserJoinedMessage`, `UserLeftMessage`) and `MessageType` in shared/src/index.ts

---

## Phase 3 — User Story 1: Monorepo + Project Skeletons

> **Story goal**: Both `/client` and `/server` run independently with no errors.
> **Independent test**: `npm run dev -w client` opens browser at localhost:5173; `npm run dev -w server` prints "listening on port 3001".

- [ ] T009 Create server/package.json with `"type": "module"`, `tsx watch` dev script, `ws` dependency, `@types/ws`+`tsx`+`typescript` devDependencies in server/package.json
- [ ] T010 [P] Create server/tsconfig.json extending `../tsconfig.base.json` with `"module": "NodeNext"` in server/tsconfig.json
- [ ] T011 [P] Create client/package.json with Vite 4, React 18, `codemirror`, `@codemirror/lang-javascript`, `react-router-dom` dependencies in client/package.json
- [ ] T012 [P] Create client/tsconfig.json extending `../tsconfig.base.json` with `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"jsx": "react-jsx"` in client/tsconfig.json
- [ ] T013 [P] Create client/vite.config.ts with `@vitejs/plugin-react` plugin and `@crdt/shared` path alias pointing to `../shared/src` in client/vite.config.ts
- [ ] T014 [P] Create client/index.html with `<div id="root">` mount point and dark background base styles in client/index.html
- [ ] T015 [P] Create client/src/vite-env.d.ts declaring `VITE_WS_URL` in `ImportMetaEnv` in client/src/vite-env.d.ts
- [ ] T016 Run `npm install` from monorepo root to install all workspace dependencies

---

## Phase 4 — User Story 2: CodeMirror 6 Editor

> **Story goal**: A CodeMirror editor with JavaScript syntax highlighting renders at `/room/:roomId`.
> **Independent test**: Navigate to `localhost:5173/room/test` — editor is visible, accepts input, highlights JS tokens.

- [ ] T017 Create client/src/App.tsx with `BrowserRouter` routes: `/` → `<Home>`, `/room/:roomId` → `<Room>`, `*` → redirect to `/` in client/src/App.tsx
- [ ] T018 Create client/src/main.tsx mounting `<App>` into `#root` with `React.StrictMode` in client/src/main.tsx
- [ ] T019 [US2] Create client/src/pages/Home.tsx with "Create room" button (generates random slug) and "Join room" form navigating to `/room/:roomId` in client/src/pages/Home.tsx
- [ ] T020 [US2] Create client/src/pages/Room.tsx mounting a `CodeMirror EditorView` with `basicSetup` + `javascript()` extension into a `useRef` container div in client/src/pages/Room.tsx

---

## Phase 5 — User Story 3: WebSocket Server + RoomManager

> **Story goal**: Server accepts WS connections, assigns UUIDs, manages room membership, broadcasts correctly.
> **Independent test**: `wscat -c ws://localhost:3001/room/test` → server logs new connection; send a message from two clients — sender excluded from broadcast.

- [ ] T021 [US3] [P] Create `RoomManager` class with `rooms: Map<string, Set<Client>>`, `join()`, `leave()`, `broadcast(roomId, msg, excludeId?)`, `assignColor()`, `getTotalConnections()`, `getRoomCount()` in server/src/room-manager.ts
- [ ] T022a [US3] [P] Create HTTP server and `GET /health` endpoint returning `{ status, connections, rooms }` in server/src/index.ts
- [ ] T022b [US3] Add WebSocket server on `/room/:roomId`; validate roomId against `/^[a-z0-9-]{1,64}$/i` (close `1008` if invalid); assign `client.id` and `client.userId` via `crypto.randomUUID()`; call `RoomManager.join()` and broadcast `user-joined` to room peers in server/src/index.ts
- [ ] T022c [US3] Add connection guards: 64 KB message size check (`buf.length > MAX_MESSAGE_BYTES` → discard); sliding-window rate limit 50 ops/s per `clientId` (in-memory Map); discard malformed JSON with `console.warn` in server/src/index.ts
- [ ] T022d [US3] Add heartbeat: `ping` every 30 s; mark alive on `pong`; call `ws.terminate()` if no pong within 10 s; track liveness with `WeakMap<WebSocket, boolean>` in server/src/index.ts
- [ ] T022e [US3] Add `ws.on('close')` cleanup: clear heartbeat timer, delete rate-limit entry, call `RoomManager.leave()`, broadcast `user-left`; add 60 s `setInterval` logging `rooms` and `connections` (NFR-V observability) in server/src/index.ts

---

## Phase 6 — User Story 4: `useWebSocket` Hook

> **Story goal**: React hook that auto-reconnects with exponential backoff; surfaces `error` status after 5 failed attempts.
> **Independent test**: Kill server → console shows retry delays (1s, 2s, 4s…); header badge turns `error` after 5 attempts; restart server → hook reconnects and badge returns to `open`.

- [ ] T023 [US4] Create `useWebSocket(url, options)` hook with: exponential backoff (`reconnectBaseMs * 2^n`, capped at `reconnectMaxMs`); `error` status after `errorAfterAttempts` (default 5) consecutive failures; cleanup on unmount (`ws.close()`, cancel retry timer); stable `onMessage` ref to avoid re-subscriptions in client/src/hooks/useWebSocket.ts

---

## Phase 7 — User Story 5: End-to-End Room Connection

> **Story goal**: Two browser tabs on the same room URL — typing in tab A produces a broadcast visible in tab B's UI log. Room isolation confirmed.
> **Independent test**: Open `localhost:5173/room/abc123` in two tabs. Type in tab A. Tab B's broadcast log panel shows the payload. Open a third tab on `/room/xyz789` — it receives nothing.

- [ ] T024 [US5] Wire `useWebSocket` into Room.tsx: if `roomId` is absent or fails `/^[a-z0-9-]{1,64}$/i` pass `null` as url (hook skips connection, render error page); otherwise construct `${VITE_WS_URL}/room/${roomId}`; pass `onMessage` to append payloads to broadcast log state array (C2 client-side guard) in client/src/pages/Room.tsx
- [ ] T025 [US5] Add `EditorView.updateListener` extension to Room.tsx: on `docChanged`, call `send({ type: 'op', payload: { from, to, insert } })` for each change in the transaction in client/src/pages/Room.tsx
- [ ] T026 [US5] Add header to Room.tsx showing: room ID, "Copy link" clipboard button, connection status badge with `error` state warning "having trouble connecting…" in client/src/pages/Room.tsx
- [ ] T027 [US5] Add broadcast log panel to the bottom of Room.tsx displaying received payloads (last 100 entries), with empty-state message "open another tab and type" in client/src/pages/Room.tsx

---

## Phase 8 — Polish & Cross-Cutting Concerns

> Goal: TypeScript compiles clean in all packages; end-of-week manual checklist passes.

- [ ] T028 [P] Run `npx tsc --noEmit` in `/server` — zero errors (NFR-003) in server/
- [ ] T029 [P] Run `npx tsc --noEmit` in `/client` — zero errors (NFR-003) in client/
- [ ] T030a [P] Run `npx tsc --noEmit` in `/shared` — zero errors (NFR-003; C1 fix) in shared/
- [ ] T030 Manual smoke test — open two tabs on `/room/abc123`: confirm broadcast payload appears in tab B's log, server logs show room join and op receipt
- [ ] T031 Reconnect smoke test — kill server mid-session: confirm retry log in browser console, `error` badge after 5 attempts; restart server: confirm reconnect and `open` status restored (NFR-005)

---

## Dependencies

```
Phase 1 (Setup)
  └─► Phase 2 (Shared types)
        ├─► Phase 3 (US1 — scaffolding)
        │     ├─► Phase 4 (US2 — CodeMirror editor)
        │     ├─► Phase 5 (US3 — WebSocket server)  ─────┐
        │     └─► Phase 6 (US4 — useWebSocket hook) ─────┤
        │                                                  ▼
        └────────────────────────────────────────► Phase 7 (US5 — end-to-end)
                                                          │
                                                          ▼
                                                   Phase 8 (Polish)
```

**Independent stories** (can be worked in parallel after Phase 3 completes):
- US2 (CodeMirror editor) — client-only, no server dependency
- US3 (WebSocket server) — server-only, no client dependency
- US4 (useWebSocket hook) — client-only, no server dependency until US5

---

## Parallel Execution Examples

### Day 3 parallel tracks (after US1 scaffolding done)

```
Track A (server)          Track B (client)
─────────────────         ────────────────────────────
T021 RoomManager          T019 Home.tsx
T022 server/index.ts      T020 Room.tsx (CodeMirror)
                          T023 useWebSocket hook
```

### Day 5 parallel tasks within US5

```
T024 + T025 + T026 + T027 all touch Room.tsx but address different sections
→ implement sequentially in the order listed (hook wiring → listener → header → log panel)
```

---

## Implementation Strategy

1. **Start with Phase 1–2** (~30 min) — config files, shared types, `npm install`
2. **US1 smoke test first** — verify both `npm run dev -w server` and `npm run dev -w client` work before writing any feature code
3. **US3 before connecting the client** — test `RoomManager` with `wscat` in isolation; catch broadcast bugs before React is involved
4. **US4 in isolation** — mount a test page with the hook, kill/restart the server, verify backoff in console before wiring to the editor
5. **US5 as integration proof** — US2 + US3 + US4 must all pass their independent tests before running the two-tab broadcast test
