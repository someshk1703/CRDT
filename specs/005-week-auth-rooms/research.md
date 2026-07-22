# Research: Week 5 — Auth, Rooms, and Polished UX

**Feature**: [spec.md](./spec.md)
**Branch**: `005-week-auth-rooms`
**Created**: 2026-07-22

---

## Decision 1: JWT Token Transport at WebSocket Upgrade

**Question**: How should the Supabase session JWT reach the server during the WebSocket upgrade handshake?

**Decision**: Pass the access token as a query parameter on the WebSocket URL — `wss://server/room/{slug}?token=<access_token>`.

**Rationale**:
- The browser `WebSocket` API does not allow custom headers at connection time (the standard does not expose `Authorization` header control from client JS). The only standard mechanism for passing data before the upgrade completes is the URL query string or the `Sec-WebSocket-Protocol` subprotocol field.
- Query parameter is simpler to implement, debug (visible in network tab), and is the approach Supabase itself uses internally for its Realtime subscriptions.
- The exposure window is minimal: the token lives in the URL only during the TLS-encrypted upgrade request; it is not visible in the response or any subsequent frames. For a portfolio project operating over WSS this is an acceptable trade-off.
- **Risk**: Tokens in URLs can appear in server access logs. Mitigation: configure the server to not log WebSocket upgrade URLs (or scrub the `token` param), and use short-lived tokens (Supabase issues 1-hour access tokens by default).

**Alternatives considered**:
- `Sec-WebSocket-Protocol` header trick: encode the token as a fake subprotocol string (e.g., `["access_token", "<jwt>"]`). Works cross-browser but is semantically incorrect and opaque to debugging tools. Rejected for readability.
- Cookie-based auth: requires `SameSite=None; Secure` config and CORS credential sharing with the WebSocket server. Adds setup complexity for a separate-origin deployment. Rejected.
- Post-connection auth message: client sends a token in the first WebSocket frame after connection is accepted. The spec explicitly requires rejecting at upgrade, not after. Rejected by requirement.

**Implementation**: `new WebSocket(\`wss://\${WS_HOST}/room/\${slug}?token=\${session.access_token}\`)`. Server extracts from `req.url` during the `upgrade` event before calling `wss.handleUpgrade`.

---

## Decision 2: Supabase Auth JWT Validation

**Question**: How should the server validate the JWT from Supabase Auth?

**Decision**: Validate the JWT using Supabase's `supabase.auth.getUser(token)` call on the server, using the existing Supabase service-role client.

**Rationale**:
- Supabase JWTs are RS256-signed. Validating them locally requires distributing the public key and keeping it in sync — a manual maintenance burden.
- `supabase.auth.getUser(token)` makes a lightweight request to Supabase Auth's introspection endpoint and returns the decoded user object. At WebSocket upgrade volume (one call per new connection, not per message) the latency is acceptable.
- Returns a structured `User` object (id, email, `user_metadata.user_name` for GitHub username, `user_metadata.avatar_url`) — no additional parsing needed.

**Alternatives considered**:
- Local `jsonwebtoken` verify with the Supabase JWT secret: possible and faster (no network call), but requires exporting the JWT secret from Supabase dashboard and rotating it if keys change. Acceptable for production; for this project the network-call approach is simpler and more maintainable.

---

## Decision 3: Room Slug Generation

**Question**: What mechanism generates unique room slugs?

**Decision**: Use `nanoid` with a custom lowercase-alphanumeric alphabet, length 10. Check uniqueness before insert; retry once on collision (collision probability at expected scale is negligible).

**Rationale**:
- 10 chars from 36-char alphabet = 3.6^10 ≈ 3.6 trillion combinations. At 1,000 rooms, collision probability on a single generation ≈ 0.0000003%. A single retry is sufficient.
- Lowercase alphanumeric slugs are URL-safe without encoding and copy cleanly.
- `nanoid` is already a common dependency in the Node/React ecosystem; no new transitive dependencies.

**Alternatives considered**:
- UUIDs: URL-safe but 36 characters is unwieldy for a shareable link. Rejected on UX grounds.
- Sequential IDs: predictable, easy to enumerate other users' rooms. Rejected on privacy grounds.
- Human-readable word slugs (e.g., `bold-tiger-12`): appealing but requires a word list and more complex generation. Out of scope for this week.

---

## Decision 4: Language Switching Broadcast

**Question**: How should the room's current language be propagated and persisted?

**Decision**: Add a `language` field to the `rooms` table (default `'javascript'`). Broadcast a new `language` message type over WebSocket to all room participants when the language changes. Include `currentLanguage` in the catch-up payload delivered to joining clients.

**Rationale**:
- Persisting language in the `rooms` table ensures it survives server restarts and is available for the catch-up flow. No additional table needed.
- Broadcasting via WebSocket is consistent with how the rest of the room state (presence, CRDT ops) is propagated — no new transport mechanism required.
- Including `currentLanguage` in the `catchup` message is a one-field addition to the already-extended message and resolves FR-013 cleanly.

**Implementation**:
- `rooms` table: `ALTER TABLE rooms ADD COLUMN language TEXT NOT NULL DEFAULT 'javascript';`
- New WS message: `{ type: 'language', lang: string }` — broadcast to all room members on change
- `catchup` message extended: add `currentLanguage: string` field
- Client: on `language` message, call `setLanguage()` hook; on `catchup`, initialize language before rendering editor

---

## Decision 5: CodeMirror Language Packages

**Question**: Which CodeMirror 6 language extensions to bundle for the language switcher?

**Decision**: Bundle the following language packages as optional imports loaded on demand:
`@codemirror/lang-javascript` (covers JS + TS), `@codemirror/lang-python`, `@codemirror/lang-java`, `@codemirror/lang-go`, `@codemirror/lang-html`, `@codemirror/lang-css`, `@codemirror/lang-json`.

**Rationale**:
- These seven packages cover the languages listed in FR-011 and are all official CodeMirror 6 packages maintained by the CodeMirror team.
- `@codemirror/lang-javascript` handles both JavaScript and TypeScript via `javascript({ typescript: true })` — no separate TS package needed.
- All are already available in the CodeMirror 6 ecosystem; no custom grammar work.

**Bundle size**: Each language extension is small (10–40 KB minified). Dynamic imports (`import()`) can be used to code-split per language if bundle size becomes an issue; static imports are acceptable for this week.

---

## Decision 6: Deployment Platforms

**Question**: Which hosting platforms to use for frontend and WebSocket server?

**Decision**: Frontend → **Vercel** (static/SSR). WebSocket server → **Railway** (persistent Node.js service).

**Rationale**:
- **Vercel**: Native Next.js/Vite support, automatic HTTPS, preview deployments per branch, free tier generous enough for a portfolio project. GitHub OAuth redirect URIs work out of the box.
- **Railway**: Persistent container runtime, no cold-start issues, supports arbitrary `Dockerfile` or auto-detects Node.js. Persistent long-lived WebSocket connections are first-class — no function timeout. Free trial tier sufficient for demo load.
- **Why not Vercel for WebSocket server**: Vercel's execution model is serverless (AWS Lambda under the hood). Lambda functions are stateless and have a maximum execution timeout (typically 30s on Pro, less on Hobby). A WebSocket connection that must remain open for the duration of an editing session (potentially 30+ minutes) is fundamentally incompatible with stateless ephemeral functions. The `RoomManager` in-memory state would also be lost on every cold start.

**Alternatives considered**:
- Render: Similar to Railway; valid alternative. Railway chosen for simpler CLI workflow.
- Fly.io: More powerful (persistent volumes, multi-region) but more configuration overhead. Out of scope.
- Self-hosted VPS: Requires server management; not appropriate for a portfolio showcase.

---

## Decision 7: Room Access Control

**Question**: Should room creation/joining require ownership, invitation, or be open?

**Decision**: Rooms are **open-join** — any authenticated user with the room URL can join. Room creation records the creator as owner (for "recent rooms" display), but the owner has no gate-keeping powers over who can join or edit in Week 5.

**Rationale**:
- Spec explicitly scopes language switching to any user in the room (not owner-only). Consistent model: all room members are equal editors.
- Open-join with auth guard (must be logged in) is the right balance: prevents random anonymous edits while allowing easy collaboration via link sharing.
- Per-room ACL or invite system is out of scope; noted as a potential Week 6+ enhancement.

---

## Decision 8: Recent Rooms Storage

**Question**: How are "recent rooms" tracked per user?

**Decision**: Add a `room_members` join table: `(user_id, room_id, last_visited_at)`. Upsert a row each time a user joins a room. The home page queries the 10 most recent rows for the authenticated user ordered by `last_visited_at DESC`.

**Rationale**:
- A single table cleanly models both room membership and visit recency.
- Upsert on every join (update `last_visited_at` if row exists) keeps the query simple and the data fresh.
- 10 rooms is a reasonable home-page limit that avoids pagination complexity while still being useful.

---

## All NEEDS CLARIFICATION Items Resolved

| Item | Resolution |
|------|-----------|
| JWT transport mechanism | Query parameter on WebSocket URL |
| JWT validation approach | `supabase.auth.getUser(token)` on server |
| Slug generation | `nanoid` length 10, lowercase alphanumeric |
| Language broadcast mechanism | New `language` WS message + `rooms.language` column |
| Language packages | 7 official CodeMirror 6 packages |
| Deployment platforms | Vercel (frontend) + Railway (WebSocket server) |
| Room access model | Open-join for authenticated users |
| Recent rooms storage | `room_members` join table |
