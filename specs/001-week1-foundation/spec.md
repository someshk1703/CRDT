# Feature Specification: Week 1 — Foundation (Editor + WebSocket Skeleton)

**Feature Branch**: `001-week1-foundation`
**Created**: 2026-07-05
**Status**: Active
**Week**: 1 of 6

## Goal

By end of week: two browser tabs on the same room, connected over WebSocket, and whatever
you type in one tab shows up in the server's log. No CRDT yet — that comes in Week 2.
This week is pure plumbing.

**End-of-week definition of done**:
- [ ] Two tabs can join the same room over WebSocket
- [ ] Typing in tab A produces a broadcast the server sends to tab B (visible in console/log)
- [ ] Reconnect with exponential backoff works if the server is killed and restarted mid-session
- [ ] You can explain, without looking anything up, what `EditorState` and `Transaction` are and
      why they matter for the CRDT that hooks in next week

---

## User Stories

### User Story 1 — Monorepo + Project Skeletons (Priority: P1)

As a developer, I need a monorepo with a working Vite/React client and a Node.js WebSocket
server so that both sides can run independently and are ready to be wired together.

**Why this priority**: Everything else this week depends on having a runnable project structure.
Without it, CodeMirror and WebSocket work have nowhere to live.

**Independent Test**: Run `npm run dev` in `/client` → browser opens without errors.
Run `npm start` in `/server` → terminal prints "listening on port X". Neither crashes.

**Acceptance Scenarios**:

1. **Given** a cloned repo, **When** I run `npm install && npm run dev` in `/client`,
   **Then** a browser page opens at `localhost:5173` with no console errors.
2. **Given** a cloned repo, **When** I run `npm install && npm start` in `/server`,
   **Then** the terminal prints a "listening on port" message and the process stays alive.
3. **Given** both are running, **When** I open the browser and the server is up,
   **Then** they can theoretically communicate (no 404, no CORS hard block on root).

---

### User Story 2 — CodeMirror 6 Editor (Priority: P1)

As a user, I need a code editor rendered in the browser with syntax highlighting so that I
have a functional editing surface to build collaborative features on.

**Why this priority**: The editor is the core UI primitive. Presence, CRDT wiring, and language
switching all attach to CodeMirror. Understanding its internals now prevents painful refactors later.

**Independent Test**: Open the client in a browser → a CodeMirror editor is visible,
accepts keyboard input, and applies JavaScript syntax highlighting.

**Acceptance Scenarios**:

1. **Given** the client is running, **When** I open `localhost:5173`,
   **Then** I see a CodeMirror editor with syntax highlighting for JavaScript.
2. **Given** the editor is rendered, **When** I type code (e.g., `const x = 1`),
   **Then** the editor accepts input and highlights tokens correctly.
3. **Given** the editor is rendered, **When** I inspect the DOM,
   **Then** `EditorView`, `EditorState`, and `Transaction` are the primitives managing state
   (confirmed by reading CodeMirror docs and writing a one-paragraph summary in your notes).

**Learning checkpoint** (mandatory before moving to Week 2):
Write a one-paragraph note (anywhere — comments, Notion, notebook) answering:
- What does `EditorState` own?
- What is a `Transaction` and when is one created?
- Why does the CRDT need to intercept `Transaction` objects next week?

---

### User Story 3 — WebSocket Server + RoomManager (Priority: P1)

As a developer, I need a server that accepts WebSocket connections, assigns each client a UUID,
and manages room membership so that broadcasts can be scoped to a room.

**Why this priority**: The `RoomManager` is the server's core data structure. It MUST be correct
in isolation before the client connects to it.

**Independent Test**: Connect to the server using `wscat` or a raw WebSocket client,
send a message, and confirm the server logs it and broadcasts to other connected clients
in the same room — without a React client involved.

**Acceptance Scenarios**:

1. **Given** the server is running, **When** I connect with `wscat -c ws://localhost:3001`,
   **Then** the server logs a new connection with a generated UUID.
2. **Given** two clients connected to room `abc123`, **When** client A sends a message,
   **Then** client B receives it and client A does not (sender is excluded from broadcast).
3. **Given** a client disconnects, **When** the WebSocket closes,
   **Then** the server removes the client from the room's `Set<Client>` and logs the departure.

**Key implementation constraints**:
- `RoomManager` MUST use `Map<roomId, Set<Client>>` as its data structure
- Each `Client` MUST have: `id` (UUID), `ws` (WebSocket), `roomId`, `userId`, `color`
- `broadcast(roomId, msg, excludeId?)` MUST skip clients whose `readyState !== WebSocket.OPEN`

---

### User Story 4 — `useWebSocket` Client Hook (Priority: P1)

As a frontend developer, I need a React hook that manages the WebSocket connection lifecycle —
including reconnection with exponential backoff — so that transient connection drops are handled
automatically without user action.

**Why this priority**: A bare `new WebSocket()` with no reconnect logic is the first thing that
looks broken in a demo. Backoff MUST be implemented this week, not retrofitted later.

**Independent Test**: Kill the server while the client is connected. Wait 5 seconds. Restart
the server. Confirm the client reconnects automatically (check console logs for retry attempts).

**Acceptance Scenarios**:

1. **Given** the hook is mounted, **When** the component renders,
   **Then** a WebSocket connection is established and the hook exposes `send(message)`.
2. **Given** the server is killed, **When** the connection drops,
   **Then** the hook attempts to reconnect with delays of 1s, 2s, 4s, 8s... (exponential backoff).
3. **Given** the server restarts, **When** the hook successfully reconnects,
   **Then** the `onMessage(handler)` callback resumes receiving broadcasts normally
   and the status returns to `open` (clearing any prior `error` state).
4. **Given** the component unmounts, **When** React cleans up the effect,
   **Then** the WebSocket is closed cleanly (no memory leaks, no reconnect attempts after unmount).
5. **Given** the hook has failed to reconnect 5 consecutive times, **When** the 5th close fires,
   **Then** the hook status transitions to `error` and the UI displays a "having trouble connecting" warning.
   The hook continues retrying; if the server recovers the status returns to `open`.

---

### User Story 5 — End-to-End Room Connection (Priority: P1)

As a user, I can open two browser tabs on the same room URL (`/room/abc123`), type in one tab,
and see the message appear in the other tab's console — confirming the full client-to-server-to-
client broadcast pipeline works.

**Why this priority**: This is the Week 1 integration proof. Without this, there is no Week 2.

**Independent Test**: Open two tabs at `localhost:5173/room/abc123`. In tab A, type something.
Confirm the browser console of tab B shows the broadcast payload.

**Acceptance Scenarios**:

1. **Given** two browser tabs on `/room/abc123`, **When** tab A sends a message via the hook,
   **Then** the server logs receipt and broadcasts to tab B.
2. **Given** tab B receives the broadcast, **When** it arrives,
   **Then** the browser console of tab B prints the payload (actual editor rendering is Week 2).
3. **Given** two tabs on different rooms (`/room/abc123` and `/room/xyz789`),
   **When** a user in `abc123` types, **Then** the user in `xyz789` does NOT receive it.

---

## Edge Cases

- What happens when a client sends an empty message? → Server logs and discards it gracefully.
- What happens when a client connects to a room that doesn't exist yet? → Server creates it lazily.
- What happens if the URL has no `roomId`? → Client should not attempt to connect; show an error.
- What happens if `roomId` contains invalid characters or exceeds 64 chars? → Server closes the connection immediately with code `1008` (`Policy Violation`) before any room state is touched.

---

## Requirements

### Functional Requirements

- **FR-001**: Client MUST render a CodeMirror 6 editor with JavaScript syntax highlighting.
- **FR-002**: Server MUST accept WebSocket connections and assign each client a UUID.
- **FR-003**: Server MUST scope broadcasts to the room identified by `roomId`; cross-room
  leakage is PROHIBITED.
- **FR-004**: Server MUST exclude the sender when broadcasting to a room.
- **FR-005**: Client hook MUST implement reconnect with exponential backoff.
- **FR-006**: Room MUST be derived from the URL path (`/room/:roomId`).
- **FR-007**: `RoomManager` MUST clean up client entries on WebSocket close.

### Non-Functional Requirements

- **NFR-001**: Server MUST remain running with no crashes when a client disconnects abruptly.
- **NFR-002**: Client MUST NOT leak WebSocket connections when components unmount.
- **NFR-003**: TypeScript strict mode MUST be enabled in both `/client` and `/server`.
- **NFR-004**: Server MUST validate `roomId` against `/^[a-z0-9-]{1,64}$/i` on connection. Invalid roomIds MUST be rejected with WebSocket close code `1008` before the client is added to any room.
- **NFR-005**: `useWebSocket` MUST retry indefinitely with exponential backoff. After 5 consecutive failed reconnect attempts the hook MUST surface an `error` status so the UI can display a warning. If the server later becomes reachable the hook MUST reconnect and clear the error status.

### Key Entities

- **Client**: `{ id: string (UUID, per-connection), ws: WebSocket, roomId: string, userId: string (UUID, also per-connection in Week 1–4 — becomes JWT-derived in Week 5), color: string }`
- **Room**: `Map<roomId: string, Set<Client>>`
- **Message** (Week 1 payload): `{ type: "op" | "presence", userId: string, data: unknown }`

> **Note (from clarification 2026-07-05)**: `userId` is a fresh random UUID per WebSocket connection in Week 1–4. A user who refreshes their tab will receive a new `userId` and a new colour. This is expected behaviour until Week 5 introduces JWT-based identity.

---

## Out of Scope (Week 1)

The following are explicitly deferred to later weeks:
- CRDT operations — Week 2
- Rendering remote changes in the editor — Week 2
- Live cursors / presence decorations — Week 3
- Supabase persistence — Week 4
- Authentication (GitHub OAuth) — Week 5
- Code execution sandbox — Week 6

---

## Clarifications

### Session 2026-07-05

- Q: How should `userId` be handled before JWT auth is introduced in Week 5 — per-connection random UUID, or pre-auth stable identity via localStorage/sessionStorage? → A: Per-connection random UUID (Option A). `userId` is NOT stable across reconnects in Week 1–4. It becomes stable in Week 5 when derived from a validated JWT. Spec wording updated to reflect this.
- Q: Should the server validate the `roomId` format extracted from the URL path? → A: Yes — alphanumeric + hyphens, max 64 chars (`/^[a-z0-9-]{1,64}$/i`). Connections with an invalid roomId MUST be closed with code `1008` before joining any room. Added as NFR-004.
- Q: Should the `useWebSocket` hook ever stop retrying, or retry indefinitely? → A: Retry indefinitely, but expose an `error` status after 5 consecutive failed reconnect attempts so the UI can show a warning (Option C). The hook keeps retrying — if the server comes back, the client reconnects automatically. Added as NFR-005.

---

## Day-by-Day Build Plan

| Day | Focus | Deliverable |
|-----|-------|-------------|
| 1 | Monorepo + skeletons | Both `/client` and `/server` run; US-1 done |
| 2 | CodeMirror 6 | Editor renders with syntax highlighting; US-2 done |
| 3 | WebSocket server + RoomManager | `wscat` test passes; US-3 done |
| 4 | `useWebSocket` hook | Reconnect-with-backoff verified; US-4 done |
| 5 | Wire end-to-end | Two-tab broadcast confirmed; US-5 done |
