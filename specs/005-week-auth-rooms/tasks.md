# Tasks: Week 5 — Auth, Rooms, and Polished UX

**Branch**: `005-week-auth-rooms`  
**Input**: Design documents from `/specs/005-week-auth-rooms/`  
**Prerequisites**: [plan.md](./plan.md) · [spec.md](./spec.md) · [research.md](./research.md) · [data-model.md](./data-model.md) · [contracts/websocket-protocol.md](./contracts/websocket-protocol.md) · [quickstart.md](./quickstart.md)

## Format: `[ID] [P?] [Story?] Description with file path`

- **[P]**: Parallelizable (different files, no blocking dependency on an in-progress task)
- **[US#]**: User story this task belongs to (US1 = Auth, US2 = Rooms, US3 = Language, US4 = Toolbar, US5 = Deploy)
- Tests are not included unless the spec/constitution explicitly requires them for this feature

---

## Phase 1: Setup — Install Dependencies & Env Scaffolding

**Purpose**: Install new packages and wire environment variables so every subsequent task has a clean foundation.

- [ ] T001 Install server dependency: `nanoid` in `server/package.json`
- [ ] T002 [P] Install client dependencies: `@supabase/supabase-js`, `@codemirror/lang-python`, `@codemirror/lang-java`, `@codemirror/lang-go`, `@codemirror/lang-html`, `@codemirror/lang-css`, `@codemirror/lang-json` in `client/package.json`
- [ ] T003 [P] Add new env vars to `server/.env.example`: `ALLOWED_ORIGIN` (deployed frontend URL)
- [ ] T004 [P] Add new env vars to `client/.env.example`: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WS_URL`
- [ ] T005 [P] Create local `client/.env.local` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WS_URL=ws://localhost:3001` (gitignored — do not commit)

---

## Phase 2: Foundational — Supabase Auth Config + DB Migration

**Purpose**: Configure GitHub OAuth in Supabase and run the DB migration. Nothing in Phases 3–7 can work until Supabase Auth is enabled and the `room_members` / `rooms.language` / `rooms.owner_id` columns exist.

**⚠️ MUST complete before any user story work begins**

- [ ] T006 In Supabase dashboard: enable GitHub OAuth provider; copy callback URL; create GitHub OAuth App; paste Client ID + Secret back into Supabase (manual step — follow [quickstart.md Step 1](./quickstart.md))
- [ ] T007 Run the Week 5 DB migration in Supabase SQL editor: add `rooms.language`, `rooms.owner_id`; create `room_members` table with RLS policy (migration SQL in [data-model.md](./data-model.md))
- [ ] T008 Update `server/src/db/schema.sql` to reflect the two new columns on `rooms` and the new `room_members` table (keep in sync with applied migration)

**Checkpoint**: GitHub OAuth works in Supabase dashboard (test via Supabase Auth UI); `room_members` table visible in database inspector.

---

## Phase 3: User Story 1 — Authenticated Login via GitHub (Priority: P1) 🎯

**Goal**: Replace anonymous UUIDs with real GitHub identities. JWT validated at WebSocket upgrade. Unauthenticated users cannot reach any room.

**Independent Test**: Visit app without being logged in → redirected to login. Complete GitHub OAuth → land on home page with GitHub username and avatar. Try to connect WebSocket without a token → server closes connection before `welcome` is sent.

### Shared Type Definitions (blocks all stories)

- [ ] T009 Update `shared/src/index.ts` to add `WelcomeMessage` (with `username: string`, `avatarUrl: string`), `LanguageChangeMessage` (`{ type: 'language'; lang: string; changedBy?: string }`), and extend `CatchupMessage` with `currentLanguage: string` per [contracts/websocket-protocol.md](./contracts/websocket-protocol.md)

### Server — Auth Middleware

- [ ] T010 [P] Create `server/src/auth.ts`: export `validateToken(token: string): Promise<SupabaseUser | null>` that calls `supabase.auth.getUser(token)` and returns the user object or `null` on failure/expiry
- [ ] T011 [P] Update `server/src/room-manager.ts`: add `clientMeta: Map<WebSocket, ClientMeta>` where `ClientMeta = { userId, username, avatarUrl, roomId }` (interface defined inline); populate on connection, clear on `close`/`error`
- [ ] T012 Update `server/src/index.ts`: replace the current `server.on('upgrade')` handler (or add one if absent) to extract `token` from `req.url` query string, call `validateToken`, destroy socket with HTTP 401 if missing/invalid, and pass validated `user` + `roomId` into `wss.handleUpgrade` callback — no room data sent before this gate
- [ ] T013 Update `server/src/index.ts`: enrich the `welcome` message to include `username` and `avatarUrl` from the validated user; change `userId` from ephemeral UUID to `user.id` (stable Supabase ID)
- [ ] T014 [P] Update `server/src/index.ts`: add CORS headers (`Access-Control-Allow-Origin: process.env.ALLOWED_ORIGIN`) for HTTP endpoints; handle `OPTIONS` preflight

### Client — Auth Session

- [ ] T015 Create `client/src/hooks/useSession.ts`: initialize `createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)`; export `{ session, user, signIn, signOut }` where `signIn` calls `supabase.auth.signInWithOAuth({ provider: 'github' })` and `signOut` calls `supabase.auth.signOut()` **then** closes any open WebSocket via a `closeActiveWs` callback (passed in or stored as a ref by `Room.tsx`) before clearing session state; subscribe to `onAuthStateChange` to keep session reactive
- [ ] T016 Update `client/src/pages/Home.tsx`: if `session` is null, render a centered "Sign in with GitHub" button that calls `signIn()`; if `session` exists, render the home content (room list placeholder) with username and avatar in the header
- [ ] T017 Update `client/src/pages/Room.tsx`: guard route — if no session, redirect to home/login before attempting any WebSocket connection
- [ ] T018 Update `client/src/hooks/useCRDT.ts`: pass `?token=${session.access_token}` on the WebSocket URL construction; on WebSocket `close` with code 1008 (policy violation) or 4001, surface an "Authentication failed" message to the user rather than looping reconnect attempts

**Checkpoint**: `npm run dev` in both `client/` and `server/`; open `http://localhost:5173`; see login screen; complete GitHub OAuth; see home page with GitHub username; open browser devtools Network tab; attempt direct WebSocket connection without token → server returns HTTP 401 upgrade rejection.

---

## Phase 4: User Story 2 — Create and Share a Room (Priority: P1)

**Goal**: Explicit room creation with nanoid slug, shareable URLs, recent-rooms list on home page, and cold-join with catch-up.

**Independent Test**: Click "Create room" → redirected to `/room/{slug}`. Copy URL, open in second browser window (different GitHub account) → both windows live-sync edits. Home page shows the created room in "Recent rooms".

### Server — Room REST API + DB Operations

- [ ] T019 Update `server/src/db/operations.ts`: add `createRoom(slug, name, language, ownerId)` that inserts into `rooms`; add `getRoomBySlug(slug)` that selects one room; add `upsertRoomMember(userId, roomId)` that upserts into `room_members` setting `last_visited_at = now()`; add `getRecentRoomsForUser(userId)` that joins `rooms` + `room_members` ordered by `last_visited_at DESC LIMIT 10`
- [ ] T020 Update `server/src/db/operations.ts`: update `persistOp` / `upsertRoom` calls to include `owner_id` and `language` (previously only upserted `id` + `name`); update `catchup` assembly to include `currentLanguage: room.language` in the payload sent to joining clients
- [ ] T021 Create `server/src/rooms.ts`: implement `generateUniqueSlug()` using `nanoid(10)` with alphabet `0123456789abcdefghijklmnopqrstuvwxyz`; add uniqueness check (call `getRoomBySlug`, retry once on collision); export HTTP handlers: `createRoomHandler` (`POST /rooms`), `listRoomsHandler` (`GET /rooms`), `getRoomHandler` (`GET /rooms/:slug`) — all validate JWT via `validateToken` from `auth.ts`
- [ ] T022 [P] Update `server/src/index.ts`: register REST routes `POST /rooms`, `GET /rooms`, `GET /rooms/:slug` before the WebSocket upgrade handler; add JSON body parsing
- [ ] T023 Update `server/src/index.ts`: on every WebSocket connection (after upgrade), call `upsertRoomMember(user.id, roomId)` to record visit; pass `user.id` as `ownerId` when upserting the room row (so rooms created via direct URL navigation also record an owner)

### Client — Room Creation + Navigation

- [ ] T024 Create `client/src/hooks/useRooms.ts`: export `createRoom(name?, language?)` that calls `POST /rooms` with `Authorization: Bearer {token}` and returns the created room; export `listRooms()` that calls `GET /rooms`; export `getRoom(slug)` that calls `GET /rooms/:slug`; use `import.meta.env.VITE_API_URL` as the HTTP base URL (e.g. `http://localhost:3001` locally, `https://{railway-url}` in production) — **do not** derive this from `VITE_WS_URL` by stripping the protocol
- [ ] T025 Update `client/src/pages/Home.tsx`: add "Create room" button that calls `createRoom()` then navigates to `/room/{slug}`; render the list returned by `listRooms()` with room name, language badge, and "Open" link per room
- [ ] T026 [P] Update `client/src/pages/Room.tsx`: call `getRoom(slug)` on mount to fetch room metadata (`name`, `language`); pass metadata down to the editor and toolbar; handle 404 with a "Room not found" UI state

- [ ] T050 Add `PATCH /rooms/:slug` handler in `server/src/rooms.ts`: accept `{ name: string }` body; validate JWT via `validateToken`; update `rooms.name` in Supabase; broadcast `{ type: 'room-meta', name }` to all current room members via `RoomManager`; respond `200 { id, name }`
- [ ] T051 [P] Add `room-meta` message handling to `server/src/index.ts`: add the broadcast call from the PATCH handler; extend `shared/src/index.ts` with `RoomMetaMessage = { type: 'room-meta'; name: string }`
- [ ] T052 [P] Update `client/src/pages/Room.tsx`: add an inline editable room-name input in the toolbar area (or rely on `Toolbar.tsx` prop); on blur/Enter, call `PATCH /rooms/:slug` via a `renameRoom(slug, name)` export from `useRooms.ts`; on `room-meta` WS message, update the local `roomName` state so all connected users see the change immediately

**Checkpoint**: Create room → unique slug URL generated → redirected to `/room/{slug}` → second browser joins same URL → edits sync. Home page lists recent rooms. Owner renames room in the toolbar → both browsers show updated name.

---

## Phase 5: User Story 3 — Live Language Switching (Priority: P2)

**Goal**: Toolbar dropdown switches editor language for all connected users in real time. New joiners receive current language in catch-up.

**Independent Test**: Open room in two windows; window A selects Python → window B's editor switches to Python immediately. Close both windows, reopen → Python is still active.

### Shared Language Extension Map

- [ ] T027 Create `client/src/extensions/languageSwitcher.ts`: export `SUPPORTED_LANGUAGES` constant (`Record<string, { label: string; extension: () => LanguageSupport }>`) mapping `'javascript'` → `javascript()`, `'typescript'` → `javascript({ typescript: true })`, `'python'` → `python()`, `'java'` → `java()`, `'go'` → `go()`, `'html'` → `html()`, `'css'` → `css()`, `'json'` → `json()`; export `getLanguageExtension(lang: string): LanguageSupport` with fallback to JavaScript

### Server — Language Message Handler

- [ ] T028 Update `server/src/index.ts`: handle `{ type: 'language', lang }` message — validate `lang` against allowed set (reject silently if invalid); call `updateRoomLanguage(roomId, lang)` (see T029); broadcast `{ type: 'language', lang, changedBy: user.id }` to all room members including sender
- [ ] T029 Update `server/src/db/operations.ts`: add `updateRoomLanguage(roomId: string, lang: string): Promise<void>` that runs `UPDATE rooms SET language = $lang WHERE id = $roomId`

### Client — Language Switching

- [ ] T030 Update `client/src/hooks/useCRDT.ts`: handle incoming `{ type: 'language', lang }` message by calling a `setLanguage` callback; on `catchup` receipt, read `currentLanguage` and call the same `setLanguage` callback before first render; expose `sendLanguageChange(lang: string)` that sends `{ type: 'language', lang }` over the WebSocket; **race-condition guard**: if a `language` message arrives before `setLanguage` callback is registered (e.g. before `EditorView` mounts), buffer the value in a `pendingLanguage` ref and flush it immediately when the callback is first provided
- [ ] T031 Update `client/src/pages/Room.tsx`: hold `language` state (`useState`, initialized from `catchup`); wire `setLanguage` callback to `useCRDT`; pass `language`, `setLanguage`, and `sendLanguageChange` to the `Toolbar` and editor components
- [ ] T032 Update the CodeMirror editor in `client/src/pages/Room.tsx` (or wherever the `EditorView` is configured): use a `Compartment` for the language extension; on `language` state change call `view.dispatch({ effects: languageCompartment.reconfigure(getLanguageExtension(language)) })`

**Checkpoint**: Select Python in window A → window B's editor syntax highlighting switches to Python within 300ms. Open new window → loads Python. Kill and restart server → room still has Python on re-join.

---

## Phase 6: User Story 4 — Toolbar Polish (Priority: P2)

**Goal**: Room toolbar shows room name, language dropdown, copy-link button, connected user count, and avatar stack. All data is sourced from already-available room metadata and presence state.

**Independent Test**: Open room with two logged-in users → toolbar shows both avatars, "2 connected", room name. Click copy link → paste → full room URL. One user disconnects → avatar disappears.

### Server — Enrich Broadcasts with Identity

- [ ] T033 Update `server/src/index.ts`: when broadcasting the `presence` message to peers, server enriches it with `username` and `avatarUrl` from `clientMeta` (do not rely on client to send identity in presence payload)
- [ ] T034 Update `server/src/index.ts`: enrich `user-joined` broadcast to include `username` and `avatarUrl` from `clientMeta`

### Client — Toolbar Component

- [ ] T035 [P] Update `client/src/hooks/usePresence.ts`: extend the per-user presence entry type to include `username: string` and `avatarUrl: string`; populate from the `welcome` message (self) and from incoming `presence` / `user-joined` messages (peers)
- [ ] T036 Create `client/src/components/Toolbar.tsx`: accept props `{ roomName: string, roomSlug: string, language: string, onLanguageChange: (lang: string) => void, connectedUsers: Array<{ userId, username, avatarUrl }> }`; render:
  - Room name as a text label
  - Language `<select>` dropdown populated from `SUPPORTED_LANGUAGES` keys; calls `onLanguageChange` on change
  - Copy-link button: calls `navigator.clipboard.writeText(window.location.href)` on click; falls back to displaying the URL in a `<input readOnly>` if clipboard API is unavailable or throws
  - Avatar stack: `<img>` per user (max 5 shown, `+N` overflow badge); title tooltip = username
  - User count badge: "N connected"
  - Stubbed "Run" button (disabled, no click handler, visually greyed out)
- [ ] T037 Update `client/src/pages/Room.tsx`: render `<Toolbar>` with `roomName`, `roomSlug`, `language`, `onLanguageChange={sendLanguageChange}`, `connectedUsers` sourced from presence state

**Checkpoint**: Two users in same room → toolbar shows both avatars + "2 connected" + room name. Language dropdown changes language for both. Copy link → paste → correct URL. One user closes tab → avatar gone within heartbeat interval.

---

## Phase 7: User Story 5 — Deployment (Priority: P1)

**Goal**: Full stack live on public HTTPS/WSS URLs. Two users on separate devices can collaborate end-to-end.

**Independent Test**: Two different people on two different devices open the Vercel URL, sign in with GitHub, create/join the same room, edit live.

### Pre-Deploy Hardening

- [ ] T038 [P] Update `server/src/index.ts`: ensure `GET /health` returns `{ status: "ok", connections: N, rooms: M }` (update room count to use the `RoomManager`'s map size)
- [ ] T039 [P] Add `Dockerfile` to `server/` using a two-stage build: **Stage 1 (builder)** — `FROM node:20-alpine AS builder`, copy `package*.json`, run `npm ci`, copy `src/` and `tsconfig.json`, run `npm run build` to compile TypeScript to `dist/`; **Stage 2 (runtime)** — `FROM node:20-alpine`, copy `package*.json`, run `npm ci --production`, copy `dist/` from builder stage, expose `PORT`, `CMD ["node", "dist/index.js"]`; verify `npm run build` succeeds locally before writing the Dockerfile
- [ ] T040 [P] Verify `server/tsconfig.json` has `"outDir": "dist"` and `package.json` has `"build": "tsc"` and `"start": "node dist/index.js"` scripts

### Frontend Deployment — Vercel

- [ ] T041 Deploy `client/` to Vercel: run `npx vercel --cwd client` (or connect via Vercel GitHub integration); set environment variables in Vercel dashboard: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WS_URL=wss://{railway-url}`
- [ ] T042 Update Supabase project settings: set **Site URL** to the Vercel deployment URL; add the Vercel URL to **Redirect URLs** in Authentication → URL Configuration
- [ ] T043 Update GitHub OAuth App (created in T006): set Homepage URL and Authorization callback URL to the production Vercel URL and Supabase callback URL respectively

### WebSocket Server Deployment — Railway

- [ ] T044 Deploy `server/` to Railway: connect GitHub repo in Railway dashboard → select `server/` as root; set environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_ORIGIN={vercel-url}`, `PORT=3001`
- [ ] T045 After Railway deploy: copy the Railway public URL; update `VITE_WS_URL` in Vercel environment to `wss://{railway-url}`; trigger Vercel redeploy

### Smoke Test (End-to-End on Production)

- [ ] T046 [P] Smoke test: open deployed Vercel URL in two separate browsers on two separate devices; sign in with GitHub on both; create a room on device 1; open the shared URL on device 2; confirm real-time editing, language switch, and avatar presence all work on the live deployment; **stability check**: after confirming live sync, leave both windows idle for **5 minutes** and confirm both connections remain open (no disconnect/reconnect in the browser Network tab WS frames) — validates heartbeat and Railway keepalive are working per SC-007

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T047 [P] Update `README.md`: add live demo link (Vercel URL), architecture diagram reference (`specs/005-week-auth-rooms/diagrams/system-architecture.md`), note on why WebSocket server cannot run on Vercel (serverless statelessness + persistent connections), and local setup steps linking to [quickstart.md](./quickstart.md)
- [ ] T048 [P] Audit `.gitignore` in repo root, `client/`, and `server/`: confirm `.env`, `.env.local`, `dist/`, `node_modules/` are all ignored
- [ ] T049 Verify and annotate `server/.env.example` to document all **five** server-side variables (T003 created the `ALLOWED_ORIGIN` entry; this task adds inline comments to all entries): `SUPABASE_URL` (Supabase project URL), `SUPABASE_SERVICE_ROLE_KEY` (service role key — never expose to client), `SNAPSHOT_INTERVAL` (ops between snapshots, default 100), `PORT` (HTTP/WS port, default 3001), `ALLOWED_ORIGIN` (deployed frontend URL for CORS); also ensure `client/.env.example` documents `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_WS_URL`, and `VITE_API_URL`
- [ ] T050b [P] Add `setInterval` in `server/src/index.ts` that emits a stats line to stdout every 60 000ms: `[stats] rooms=N clients=M` where N is `roomManager.rooms.size` and M is the total WebSocket connections across all rooms; also emit once at server startup — satisfies Constitution Principle V

---

## Phase 9: Tests (Constitution Principle IV — Non-Negotiable)

**Purpose**: Validate the new auth middleware, REST API, and language-broadcast flows against the spec's acceptance scenarios. The constitution requires 80% coverage for new server logic and a Playwright E2E test for integration flows.

**⚠️ Write tests BEFORE or alongside implementation (TDD preferred); ensure they fail before the implementation task is complete**

### Unit Tests — Server Auth Middleware (`server/src/auth.ts`)

- [ ] T053 [P] Add Vitest unit tests in `server/src/auth.test.ts` for `validateToken`:
  - **Given** a valid Supabase JWT, **When** `validateToken` is called, **Then** it returns a `User` object with `id`, `user_metadata.user_name`, `user_metadata.avatar_url`
  - **Given** an expired token, **When** `validateToken` is called, **Then** it returns `null`
  - **Given** a missing/empty string, **When** `validateToken` is called, **Then** it returns `null` without throwing
  - Mock `supabase.auth.getUser` with Vitest `vi.mock`

### Unit Tests — Room Slug Generation (`server/src/rooms.ts`)

- [ ] T054 [P] Add Vitest unit tests in `server/src/rooms.test.ts` for `generateUniqueSlug`:
  - **Given** the `rooms` table has no slug collision, **When** `generateUniqueSlug` is called, **Then** it returns a 10-character lowercase-alphanumeric string
  - **Given** the first slug is already taken (mock `getRoomBySlug` to return a room on first call, then `null`), **When** `generateUniqueSlug` is called, **Then** it retries and returns a different slug

### Integration Tests — Room REST API

- [ ] T055 Add Vitest integration tests in `server/src/rooms.integration.test.ts` using a real Supabase test project (or mock the DB module):
  - `POST /rooms` — **Given** a valid JWT and `{ name: 'My Room', language: 'python' }`, **When** the handler runs, **Then** it responds 201 with `{ id, name, language, owner_id }` and the room exists in the `rooms` table
  - `POST /rooms` — **Given** no `Authorization` header, **When** the handler runs, **Then** it responds 401
  - `POST /rooms` — **Given** an invalid `language` value, **When** the handler runs, **Then** it responds 422
  - `GET /rooms` — **Given** a valid JWT with two prior room visits, **When** the handler runs, **Then** it responds 200 with those rooms ordered by `last_visited_at DESC`
  - `PATCH /rooms/:slug` — **Given** a valid JWT and `{ name: 'Renamed' }`, **When** the handler runs, **Then** it responds 200 and the `rooms` table row has the new name

### E2E Tests — Playwright (Multi-Tab)

- [ ] T056 Add Playwright E2E test in `client/tests/week5.spec.ts`:
  - **Sign-in gate**: **Given** an unauthenticated browser, **When** navigating to `/room/any-slug`, **Then** the user sees the login screen (not the editor); skip full OAuth in CI — mock the session by injecting a `localStorage` token if Supabase supports it, or use Playwright's `page.route` to stub the auth endpoint
  - **Create and join room**: **Given** two authenticated browser contexts (use Playwright's `browser.newContext()` with pre-seeded session cookies), **When** context A creates a room and navigates to `/room/{slug}`, and context B navigates to the same URL, **Then** both editors are visible and both presence avatars appear in the toolbar
  - **Language switch propagation**: **Given** two contexts in the same room, **When** context A selects Python from the language dropdown, **Then** context B's editor language extension changes to Python within 1 000ms (check via `page.locator('[data-language]').getAttribute('data-language')` or similar)
  - **No-token WebSocket rejection**: **Given** a raw WebSocket constructed without a token in the URL, **When** the connection attempt is made (use `page.evaluate`), **Then** the connection closes immediately with code 1006 or 4001 — room data frames are never received

**Checkpoint**: All Vitest tests pass (`npm test` in `server/`). Playwright suite passes (`npx playwright test` in `client/`). Coverage report for `server/src/auth.ts` and `server/src/rooms.ts` shows ≥ 80% line coverage.

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Setup)        — no dependencies; start immediately
Phase 2 (Foundation)   — depends on Phase 1; BLOCKS all user stories
Phase 3 (US1 Auth)     — depends on Phase 2; produces JWT gate + session
Phase 4 (US2 Rooms)    — depends on Phase 3 (needs validated user for room creation)
Phase 5 (US3 Lang)     — depends on Phase 4 (needs room catchup with currentLanguage)
Phase 6 (US4 Toolbar)  — depends on Phase 4 + Phase 5 (needs room metadata + language)
Phase 7 (US5 Deploy)   — depends on Phases 3–6 all working locally
Phase 8 (Polish)       — depends on Phase 7
Phase 9 (Tests)        — write alongside Phase 3–6; all must pass before Phase 7
```

### User Story Dependencies

| Story | Depends On | Can Parallelize With |
|-------|------------|----------------------|
| US1 — Auth | Phase 2 complete | — |
| US2 — Rooms | US1 complete | — |
| US3 — Language | US2 complete | US4 (Toolbar) |
| US4 — Toolbar | US2 complete | US3 (Language) |
| US5 — Deploy | US1–US4 complete, tests passing | — |

### Within Each Phase

- Tasks marked `[P]` can run in parallel with other `[P]` tasks in the same phase
- Tasks without `[P]` must complete before dependent tasks in the same phase

### Parallel Execution Examples

**Phase 1** (all parallel):
```
T001 (nanoid server install)
T002 (client deps install)     ← parallel
T003 (server .env.example)     ← parallel
T004 (client .env.example)     ← parallel
T005 (client .env.local)       ← parallel
```

**Phase 3** (auth, after T009):
```
T010 auth.ts validateToken
T011 room-manager clientMeta   ← parallel with T010
T014 server CORS               ← parallel with T010, T011
        ↓
T012 index.ts upgrade handler  (needs T010, T011)
T013 welcome message enrich    (needs T012)
        ↓ (parallel with server work)
T015 useSession.ts             ← parallel with T010–T011
T016 Home.tsx auth gate        ← parallel with T015
T017 Room.tsx auth guard       ← parallel with T015
T018 useCRDT.ts token in URL   ← parallel with T015–T017
T053 auth.test.ts              ← write alongside T010
```

**Phase 5 + Phase 6** (after Phase 4):
```
T027 languageSwitcher.ts
T028 server language handler   ← parallel with T027
T029 updateRoomLanguage DB     ← parallel with T027–T028
        ↓                              ↓
T030 useCRDT language handler         T035 usePresence identity  ← parallel
T031 Room.tsx language state          T036 Toolbar.tsx           ← parallel
T032 CodeMirror Compartment
T056 Playwright E2E             ← write alongside Phase 5/6
```

### Suggested MVP Scope

Implement phases in order to reach a testable state as fast as possible:

| Milestone | Phases | What You Can Demo |
|-----------|--------|-------------------|
| **MVP 1** | 1 + 2 + 3 | GitHub login, JWT gate on WebSocket |
| **MVP 2** | + 4 | Create rooms, share URLs, cold join with catch-up |
| **MVP 3** | + 5 + 6 | Language switching + polished toolbar |
| **Tests green** | + 9 | All Vitest + Playwright pass |
| **Shipped** | + 7 + 8 | Live on public URL, README updated |

