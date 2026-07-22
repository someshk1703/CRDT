# Implementation Plan: Week 5 — Auth, Rooms, and Polished UX

**Branch**: `005-week-auth-rooms` | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/005-week-auth-rooms/spec.md`

## Summary

Replace anonymous identities with real GitHub OAuth authentication via Supabase Auth. Add explicit room creation with shareable nanoid slugs, a `room_members` table for recent-rooms tracking, live language switching broadcast via a new `language` WebSocket message, toolbar polish surfacing presence data (avatars, user count, copy-link), and deploy the full stack to Vercel (frontend) + Railway (WebSocket server). All 22 functional requirements from the spec are addressed with no NEEDS CLARIFICATION items remaining (see [research.md](./research.md)).

## Technical Context

**Language/Version**: TypeScript 5.x (client + server + shared); Node.js 20 LTS  
**Primary Dependencies**: React 18 + Vite 5, CodeMirror 6, `ws` (WebSocket server), Supabase JS v2, `nanoid`  
**New (Week 5)**: `@supabase/supabase-js` (client), `nanoid` (server), `@codemirror/lang-python`, `@codemirror/lang-java`, `@codemirror/lang-go`, `@codemirror/lang-html`, `@codemirror/lang-css`, `@codemirror/lang-json`  
**Storage**: Supabase PostgreSQL — `rooms`, `operations`, `snapshots` (existing) + `room_members` (new) + `rooms.language`, `rooms.owner_id` columns (new)  
**Auth**: Supabase Auth, GitHub OAuth provider, JWT validated via `supabase.auth.getUser()` at WebSocket upgrade  
**Testing**: Vitest (unit), Playwright (E2E)  
**Target Platform**: Vercel (client), Railway (server), Supabase (DB + Auth)  
**Performance Goals**: Language broadcast < 300ms P95; WebSocket connections stable for 30+ minutes  
**Constraints**: 80% test coverage on new server logic; `any` types prohibited (TypeScript strict mode); no secrets in source  
**Scale/Scope**: Portfolio project; demo load (~5–10 concurrent users per room)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Specification-Driven Development** (Principle I — Incremental Build Discipline)
- [x] Feature specification exists with prioritized user stories (P1, P2, P3...)
- [x] Each user story has acceptance criteria in Given-When-Then format
- [x] Unclear requirements marked as "NEEDS CLARIFICATION" — all resolved in research.md
- [x] All user stories are independently testable

**Comprehensive Testing Standards** (Principle IV — Testing Standards)
- [x] Test strategy defined: Vitest (unit), Playwright (E2E multi-tab)
- [x] Tests will validate JWT rejection, language broadcast, room creation, catch-up language inclusion
- [x] Minimum 80% code coverage required for new server auth/room logic
- [x] Given-When-Then structure planned for all tests

**Independent User Story Implementation** (Principle I — Incremental Build Discipline)
- [x] User stories prioritized (P1: auth, rooms, deployment; P2: language switch, toolbar)
- [x] Foundational: auth + JWT validation must land before room management or language features
- [x] Each story delivers standalone, demonstrable value
- [x] Dependencies are explicit: auth → room creation → language switching → toolbar → deployment

**WebSocket & Connection Reliability** (Principle III)
- [x] JWT validated at upgrade, not after — FR-002 and Constitution III are aligned
- [x] Reconnection: existing exponential backoff from Week 1 preserved; token refreshed on reconnect
- [x] CORS: `ALLOWED_ORIGIN` env var; WSS-only in production
- [x] Heartbeat: existing ping/pong from constitution Principle III preserved (no regression)

**Observability & Documentation** (Principle V)
- [x] `GET /health` endpoint preserved and extended to include `rooms` count
- [x] Server logs per-connection: userId, roomId, token validation result
- [x] All new env vars documented in `.env.example` and quickstart.md
- [x] README will be updated with: live demo link, auth flow, deployment notes

**Quality Standards**
- [x] 80%+ test coverage target confirmed for new modules (auth middleware, room API)
- [x] TypeScript strict mode enabled; no `any` types
- [x] No secrets committed; `.env` in `.gitignore`

**Monorepo Architecture Standards**
- [x] Service boundaries unchanged: `client/`, `server/`, `shared/`
- [x] Auth token handling lives in `server/` only — client never validates JWT
- [x] No circular dependencies introduced

**Performance Standards**
- [x] Language broadcast < 300ms P95 (single DB write + fan-out to small room)
- [x] Room creation < 500ms P95 (one DB insert + one uniqueness check)
- [x] N+1 prevention: recent rooms query uses JOIN, not per-room fetches

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output — all decisions and rationale
├── data-model.md        # Phase 1 output — DB schema changes + migration SQL
├── quickstart.md        # Phase 1 output — local setup + deployment guide
├── contracts/
│   └── websocket-protocol.md  # Phase 1 output — updated WS messages + REST API
├── diagrams/
│   ├── system-architecture.md  # Mermaid: full deployed topology
│   └── data-flow.md            # Mermaid: OAuth, room creation, language switch, recent rooms
└── tasks.md             # Phase 2 output (/speckit.tasks command — NOT created by /speckit.plan)
```

### Source Code Changes

```text
server/src/
├── auth.ts               # NEW — JWT validation middleware: validateToken(req) → User | null
├── rooms.ts              # NEW — HTTP REST handlers: POST /rooms, GET /rooms, GET /rooms/:slug
├── index.ts              # UPDATED — add CORS headers, REST routes, upgrade handler with JWT gate
├── room-manager.ts       # UPDATED — clientMeta map, enrich presence/user-joined broadcasts
└── db/
    └── operations.ts     # UPDATED — add upsertRoom (with owner_id/language), upsertMember,
                          #           updateRoomLanguage; extend catchup payload with currentLanguage

client/src/
├── hooks/
│   ├── useSession.ts     # NEW — Supabase Auth session management (login, logout, session state)
│   ├── useRooms.ts       # NEW — fetch recent rooms, create room, get room by slug
│   ├── useCRDT.ts        # UPDATED — handle 'language' message; pass token in WS URL
│   └── usePresence.ts    # UPDATED — read username + avatarUrl from incoming presence messages
├── pages/
│   ├── Home.tsx          # UPDATED — login button (unauthenticated), recent rooms list (authenticated)
│   └── Room.tsx          # UPDATED — load room metadata, pass token to WS, render Toolbar
├── extensions/
│   └── languageSwitcher.ts  # NEW — CodeMirror language extension map; reconfigure on change
└── components/
    └── Toolbar.tsx       # NEW — room name, language dropdown, copy-link, avatar stack, user count

shared/src/
└── index.ts              # UPDATED — add WelcomeMessage (with username/avatarUrl),
                          #           LanguageChangeMessage, extend CatchupMessage with currentLanguage
```

## Complexity Tracking

No constitution violations. All design choices are the simplest approach that satisfies the requirement:

| Decision | Rationale |
|----------|-----------|
| Query-param JWT on WS URL | Browser WebSocket API has no custom header support; query param is the standard approach |
| `supabase.auth.getUser()` for validation | Simpler than local RS256 key management; acceptable latency at connect-time frequency |
| `nanoid` length 10 | Collision-negligible at demo scale; URL-clean; no word-list complexity |
| Language in `rooms` table column | Avoids a separate table; persists across restarts; one DB write per change |
| Open-join rooms | No ACL complexity this week; auth guard is sufficient |

