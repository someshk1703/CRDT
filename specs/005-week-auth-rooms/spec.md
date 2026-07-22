# Feature Specification: Week 5 — Auth, Rooms, and Polished UX

**Feature Branch**: `005-week-auth-rooms`  
**Created**: 2026-07-22  
**Status**: Draft  
**Input**: Week 5 context — GitHub OAuth, room management, language switching, toolbar polish, deployment

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Authenticated Login via GitHub (Priority: P1)

A visitor arrives at the app and sees a "Sign in with GitHub" prompt. They click it, authorize the app on GitHub, and land back in the app with their real GitHub identity (username, avatar) visible. Unauthenticated users cannot open or edit any room.

**Why this priority**: All other Week 5 features depend on knowing who the user is. Auth is the foundational gate — without it, room ownership, presence avatars, and JWT-secured WebSocket connections are impossible.

**Independent Test**: Can be tested end-to-end in isolation: visit the app unauthenticated, attempt to access any room, get redirected to login, complete GitHub OAuth, land on the home page with real identity shown.

**Acceptance Scenarios**:

1. **Given** a user is not logged in, **When** they navigate to the app, **Then** they see a login prompt and cannot access any room.
2. **Given** a user clicks "Sign in with GitHub", **When** they complete GitHub OAuth authorization, **Then** they are redirected back to the app with their GitHub username and avatar displayed.
3. **Given** a logged-in user, **When** the WebSocket server receives their connection request, **Then** the server validates the identity token during the connection handshake — not after — and rejects connections that carry no token or an invalid one.
4. **Given** a token that has expired, **When** the WebSocket upgrade is attempted, **Then** the server closes the connection with an appropriate status code before any room data is exchanged.

---

### User Story 2 — Create and Share a Room (Priority: P1)

A logged-in user clicks "Create room", optionally gives it a name and picks a default language, and receives a shareable URL. They send the link to a collaborator who can join cold — without any prior context — and immediately see the room's current state.

**Why this priority**: Shareable rooms are the core product value proposition. Without this, two users cannot meet in the same editing session.

**Independent Test**: Create a room, copy the URL, open in a second browser (logged in as a different user), confirm both users are editing the same document.

**Acceptance Scenarios**:

1. **Given** a logged-in user on the home page, **When** they click "Create room", **Then** a new room is created with a unique URL-safe slug and the user is redirected to `/room/{slug}`.
2. **Given** a room URL, **When** a second logged-in user navigates to that URL, **Then** they join the room and see the current document state (via catch-up).
3. **Given** a newly joined user, **When** the room has a non-default language set, **Then** the user's editor loads with that language already active — not the default.
4. **Given** a logged-in user, **When** they view their home page, **Then** they see a list of rooms they have recently created or joined.
5. **Given** a room owner, **When** they update the room name, **Then** the updated name is visible to all connected users.

---

### User Story 3 — Live Language Switching (Priority: P2)

Any user in a room can open a language dropdown and switch the editor language. The change propagates to every connected user's editor in real time. A user joining after the switch sees the room's current language, not the default.

**Why this priority**: Language switching makes the editor usable for multi-language projects. It is a self-contained feature that doesn't block auth or room sharing, but materially improves UX.

**Independent Test**: Open the same room in two browser windows. In window A, switch language from JavaScript to Python. Confirm window B's editor switches live, and that a third window opened after the switch also loads Python.

**Acceptance Scenarios**:

1. **Given** a user in a room, **When** they select a different language from the toolbar dropdown, **Then** their own editor immediately reflects the new language.
2. **Given** two users in the same room, **When** one changes the language, **Then** the other user's editor switches to the new language without a page reload.
3. **Given** a user joining a room where Python was previously selected, **When** their editor loads, **Then** it opens with Python active — the current language is part of the room's catch-up state.
4. **Given** a language change in flight, **When** the room has no connected users, **Then** the language setting persists so the next user to join sees the correct language.

---

### User Story 4 — Toolbar Polish and Room Identity (Priority: P2)

The room toolbar shows: the room name, a copy-link button that copies the shareable URL to clipboard, a count of connected users, and avatar icons for each connected user. These surfaces the already-available presence data visually.

**Why this priority**: These are low-effort, high-perceived-quality touches that make the product feel finished and shareable. They depend on presence data from Week 3 — only display logic is new.

**Independent Test**: Open a room with two logged-in users. Confirm the toolbar shows both avatars, the correct user count, the room name, and that clicking "Copy link" puts the room URL on the clipboard.

**Acceptance Scenarios**:

1. **Given** a room with two connected users, **When** a user views the toolbar, **Then** they see two avatar icons and the count "2 connected".
2. **Given** a user clicks the copy-link button, **When** they paste, **Then** the pasted value is the full room URL.
3. **Given** a room with a name set by the owner, **When** any user views the room, **Then** the room name is displayed in the toolbar.
4. **Given** a user disconnects from the room, **When** their connection drops, **Then** their avatar disappears from the toolbar within a few seconds.

---

### User Story 5 — Deployed and Publicly Accessible (Priority: P1)

The complete application — frontend and WebSocket server — is live on public URLs. Two users on separate devices can use the app end-to-end through the deployed URLs, not localhost.

**Why this priority**: Deployment is a hard exit criterion for Week 5. A working app on localhost is not a product. Public deployment validates the entire integration (auth, CORS, environment variables, WSS vs WS).

**Independent Test**: Two different people on two different devices open the deployed URL, sign in, create/join the same room, and edit collaboratively in real time.

**Acceptance Scenarios**:

1. **Given** the deployed frontend URL, **When** an unauthenticated user visits it, **Then** they see the login page — not a blank page or error.
2. **Given** two users on separate devices, **When** they join the same room via the deployed URL, **Then** edits from one user appear in the other's editor in real time.
3. **Given** the WebSocket server is deployed on a persistent host (not serverless), **When** a client connects, **Then** the connection stays open for the duration of the editing session without being dropped by infrastructure timeouts.
4. **Given** the deployed app, **When** a user completes GitHub OAuth, **Then** the redirect back to the app works correctly (no CORS or redirect-URI mismatch errors).

---

### Edge Cases

- What happens when a user's session token expires while they are mid-edit? (Connection should be closed gracefully; the user is prompted to re-authenticate rather than losing work silently.)
- What happens when a room slug collision occurs? (Slug generation must guarantee uniqueness; retry or use a longer slug on conflict.)
- What happens when a user navigates to a room URL that doesn't exist? (Show a clear "Room not found" state, not an unhandled error.)
- What happens if the language change message is received before the editor is fully initialized? (Language setting must be applied after editor mount, not dropped.)
- What happens when a user opens the copy-link button in a browser that blocks clipboard API? (Fall back to displaying the URL in a selectable text field.)

## Requirements *(mandatory)*

### Functional Requirements

**Authentication**

- **FR-001**: Users MUST authenticate via GitHub OAuth before accessing any room.
- **FR-002**: The WebSocket server MUST validate the user's identity token during the connection upgrade handshake. Connections with missing or invalid tokens MUST be rejected before any room data is sent.
- **FR-003**: The client MUST expose the authenticated user's GitHub username and avatar throughout their session.
- **FR-004**: Signing out MUST terminate any active WebSocket connection and return the user to the login screen.

**Room Management**

- **FR-005**: A logged-in user MUST be able to create a new room. Each room MUST receive a unique, URL-safe slug.
- **FR-006**: Room creation MUST allow the creator to optionally set a room name and a default language; both MUST have sensible defaults (e.g., "Untitled Room", JavaScript).
- **FR-007**: The creator of a room MUST be recorded as the room owner.
- **FR-008**: The home page MUST display the authenticated user's recently created or joined rooms.
- **FR-009**: A user navigating to `/room/{slug}` for a room they have not been to before MUST be admitted and receive the full current document state (catch-up).
- **FR-010**: Navigating to a non-existent room slug MUST display a "Room not found" message.

**Language Switching**

- **FR-011**: The room toolbar MUST provide a dropdown to switch the editor language. Supported languages MUST include at minimum: JavaScript, TypeScript, Python, Java, Go, HTML, CSS, JSON.
- **FR-012**: When a user changes the language, a language-change event MUST be broadcast to all connected users in that room. All editors MUST switch to the new language in real time.
- **FR-013**: The room's current language MUST be included in the catch-up payload so that new joiners receive the correct language without a second round-trip.
- **FR-014**: The selected language MUST be persisted with the room record so it survives server restarts.

**Toolbar & Presence**

- **FR-015**: The toolbar MUST show the room name.
- **FR-016**: The toolbar MUST include a "Copy link" button that writes the full room URL to the user's clipboard. When clipboard access is unavailable, it MUST fall back to displaying the URL in a copyable text field.
- **FR-017**: The toolbar MUST display the count of currently connected users and a stacked row of their avatars (sourced from the presence data already tracked in Week 3).
- **FR-018**: The "Run" button area MUST be present in the toolbar but visually disabled/stubbed; it MUST NOT trigger any action in this week's scope.

**Deployment**

- **FR-019**: The frontend MUST be deployed to a publicly accessible static hosting service.
- **FR-020**: The WebSocket server MUST be deployed to a host capable of maintaining persistent, long-lived connections. Serverless function platforms MUST NOT be used for the WebSocket server.
- **FR-021**: All environment-specific configuration (API keys, server URLs, OAuth redirect URIs) MUST be supplied through environment variables, not hardcoded in source.
- **FR-022**: The deployed application MUST support HTTPS/WSS for all connections.

### Key Entities

- **User**: Represents an authenticated person. Key attributes: unique identifier from the auth provider, GitHub username, avatar URL, and current session token.
- **Room**: A collaborative editing session. Key attributes: slug (unique URL-safe identifier), name, owner (user reference), current language, creation timestamp, list of recent participants.
- **Language Setting**: The active editor language for a room. Lives on the Room entity; propagated via real-time broadcast and included in catch-up.
- **Room Membership**: A record linking a user to rooms they have visited, used to populate the "recent rooms" list.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new user can complete GitHub sign-in and land in a working room in under 60 seconds from first visiting the app.
- **SC-002**: Two users on separate devices can join the same room via a shared URL and collaboratively edit with changes visible to both within 500 ms of being typed.
- **SC-003**: 100% of WebSocket connection attempts without a valid identity token are rejected at the upgrade step — none proceed to exchange room data.
- **SC-004**: Language changes propagate to all connected users within 300 ms of the broadcaster selecting a new language.
- **SC-005**: A user joining after a language change sees the correct language on first load — no additional action required.
- **SC-006**: The deployed application is reachable via public HTTPS URLs on at least two separate physical devices simultaneously.
- **SC-007**: The WebSocket server maintains connections for at least 30 minutes without infrastructure-initiated drops under normal usage.

## Dependencies

- **Week 3 spec** (`specs/003-week3-presence/spec.md`): Presence tracking (user list, connected users) is already implemented. Week 5 surfaces this data in the toolbar — no new presence logic required.
- **Week 4 spec** (`specs/004-week4-supabase-persistence/spec.md`): Supabase is already wired for database persistence. Auth and room storage extend this existing Supabase connection.
- **Supabase Auth**: GitHub OAuth provider must be enabled in the project dashboard before implementation begins. Redirect URI must match the deployed frontend URL.
- **Catch-up Protocol** (Week 4 contracts): The catch-up payload delivered to new joiners must be extended to include `currentLanguage`. The existing WebSocket protocol contract (`specs/004-week4-supabase-persistence/contracts/websocket-protocol.md`) must be updated.

## Assumptions

- Room slugs are generated as short random strings (e.g., 8–12 characters). Collision probability is negligible at the expected scale; a uniqueness check with a single retry is sufficient.
- "Recent rooms" on the home page shows the 10 most recently accessed rooms for the authenticated user.
- Language switching is a room-wide setting controlled by any user in the room (not owner-only). Access control on language selection is out of scope for this week.
- The "Run" button is intentionally stubbed and will not execute any code. It is present only for visual completeness (scoped to Week 6 / bonus).
- Avatar display in the toolbar uses the GitHub avatar URL already available from the auth provider. No separate image upload or processing is needed.
- WebSocket connections authenticate via a short-lived token passed in the connection request (e.g., query parameter during upgrade). Token rotation during an active session is out of scope; re-authentication happens on reconnect.
- CORS configuration for the deployed WebSocket server must explicitly allowlist the deployed frontend origin.
