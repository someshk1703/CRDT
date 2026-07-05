# Real-Time Collaborative Code Editor (CRDT)

> **[Demo GIF placeholder — add a 10s screen recording of two tabs editing simultaneously]**

A portfolio-quality, real-time collaborative code editor built from scratch using a
**Conflict-free Replicated Data Type (CRDT)** — specifically the RGA (Replicated Growable Array)
algorithm. Multiple users can type simultaneously in the same file and their documents
**always converge to the same state** with no central coordinator arbitrating conflicts.

---

## How the CRDT Works

Traditional collaborative editors (like early Google Docs) use **Operational Transformation (OT)**,
which requires a central server to decide the order of conflicting operations. OT is notoriously
difficult to implement correctly.

This project uses the **RGA (Replicated Growable Array)** algorithm instead:

- Every character has a **globally unique ID** (`clientId:lamportClock`).
- Every insert records its **left neighbour's ID at insertion time** (`originId`), not a fragile
  integer position.
- When two clients insert at the same position concurrently, ties are broken **deterministically
  by `clientId`** — no server needed, no randomness.
- Deletions are **logical tombstones** — characters are never physically removed, because other
  in-flight inserts may reference them as origins. A background compaction job removes tombstones
  after all clients have acknowledged the deletion.

**Convergence guarantee**: Apply any set of operations in any order on any two RGADocument
instances → both produce identical `toString()` output. This is verified by a property-based
fuzz test in `shared/src/__tests__/crdt.convergence.test.ts`.

**Why not OT?**
OT requires a server to serialize operations. CRDT is peer-to-peer-compatible, scales horizontally
without coordination, and the algorithm is substantially easier to reason about and test in isolation.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (Tab A)                    Browser (Tab B)             │
│  ┌──────────────────┐               ┌──────────────────┐        │
│  │  CodeMirror 6    │               │  CodeMirror 6    │        │
│  │  EditorView      │               │  EditorView      │        │
│  │  Transaction ────┼──► CRDT op   │  CRDT op ────────┼──►     │
│  │  RGADocument     │               │  RGADocument     │        │
│  └──────┬───────────┘               └──────────┬───────┘        │
│         │  useWebSocket hook                    │                │
└─────────┼────────────────────────────────────────────────────────┘
          │  WebSocket (wss://)                  │
          ▼                                      ▼
┌──────────────────────────────────────────────────────────────────┐
│  Node.js WebSocket Server                                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  RoomManager: Map<roomId, Set<Client>>                   │   │
│  │  broadcast(roomId, msg, excludeSender)                   │   │
│  │  Heartbeat: ping/pong every 30s                          │   │
│  │  Rate limiting: sliding window per clientId              │   │
│  └───────────────────────┬──────────────────────────────────┘   │
└──────────────────────────┼───────────────────────────────────────┘
                           │  Supabase client (Week 4+)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase (PostgreSQL)                                          │
│  ┌──────────────┐  ┌────────────────────┐  ┌────────────────┐  │
│  │   rooms      │  │    operations      │  │   snapshots    │  │
│  │ (id, name)   │  │ (append-only log)  │  │ (every 100 ops)│  │
│  └──────────────┘  └────────────────────┘  └────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Deployment** (Week 5+):
- Frontend → **Vercel** (static + CDN)
- WebSocket server → **Railway** (persistent WebSocket connections; Vercel serverless does not support them)
- Database + Auth → **Supabase**

---

## 6-Week Build Plan

| Week | Focus | Status |
|------|-------|--------|
| 1 | Foundation — monorepo, CodeMirror 6, WebSocket skeleton | 🔄 In progress |
| 2 | CRDT — RGA algorithm, concurrent edits, convergence | ⏳ Pending |
| 3 | Presence — live cursors, user awareness, colour assignment | ⏳ Pending |
| 4 | Persistence — Supabase event log, snapshots, catch-up | ⏳ Pending |
| 5 | Auth, rooms, polished UX, deployment | ⏳ Pending |
| 6 | Bonus — sandboxed code execution (Docker) | ⏳ Pending |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 · Vite · TypeScript (strict) |
| Editor | CodeMirror 6 (`@codemirror/view`, `@codemirror/state`) |
| CRDT | Hand-rolled RGA in `/shared/src/crdt.ts` |
| Transport | WebSocket (`ws` library, Node.js) |
| Database | Supabase (PostgreSQL + Realtime) |
| Auth | Supabase Auth (GitHub OAuth) |
| Testing | Vitest (unit + convergence) · Playwright (E2E multi-tab) |
| Deployment | Vercel (client) · Railway (server) |

---

## Project Structure

```
CRDT/
├── client/                 # Vite + React + TypeScript frontend
│   ├── src/
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts     # Connection lifecycle + exponential backoff
│   │   │   └── useCollabEditor.ts  # Wires CRDT ↔ CodeMirror ↔ WebSocket
│   │   ├── plugins/
│   │   │   └── presence-plugin.ts  # CodeMirror ViewPlugin for live cursors
│   │   └── pages/
│   │       └── Room.tsx            # /room/:roomId page
│   └── package.json
├── server/                 # Node.js WebSocket server
│   ├── src/
│   │   ├── room-manager.ts         # Map<roomId, Set<Client>>, broadcast()
│   │   ├── persistence.ts          # Supabase op storage + catch-up (Week 4)
│   │   └── index.ts                # Server entry point, /health endpoint
│   └── package.json
├── shared/                 # Pure TypeScript — no framework deps
│   ├── src/
│   │   ├── crdt.ts                 # RGADocument, CRDTChar, integrateInsert
│   │   └── __tests__/
│   │       ├── crdt.unit.test.ts       # Concurrent inserts, tombstones, idempotency
│   │       └── crdt.convergence.test.ts # Fuzz: random ops → same toString()
│   └── package.json
├── specs/                  # Feature specifications (one folder per week)
│   └── 001-week1-foundation/
│       └── spec.md
├── plan/                   # Overall design docs and audit
│   └── overallPlan/
│       ├── collab_editor_spec.html
│       └── collab_editor_audit.html
├── .specify/               # Spec Kit templates and constitution
├── .env.example            # Required environment variables (no secrets)
└── README.md
```

---

## Local Setup

### Prerequisites

- Node.js 20+
- npm 9+

### Install & Run

```bash
# Install dependencies
cd client && npm install
cd ../server && npm install
cd ../shared && npm install

# Start development
cd client && npm run dev      # http://localhost:5173
cd server && npm start        # ws://localhost:3001
```

### Environment Variables

Copy `.env.example` to `.env` in the `server/` directory and fill in your Supabase credentials:

```bash
cp .env.example server/.env
```

Required variables (see `.env.example` for descriptions):

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
JWT_SECRET=
PORT=3001
```

### Run Tests

```bash
cd shared && npm test         # CRDT unit + convergence tests (Vitest)
```

---

## Key Design Decisions & Audit Notes

The full technical audit of this project (gaps, additions, and watch-out items) is in
[plan/overallPlan/collab_editor_audit.html](plan/overallPlan/collab_editor_audit.html).

**Critical gaps addressed in the implementation** (from the audit):
- Heartbeat / ping-pong on the WebSocket server (ghost client prevention)
- Message size limit enforcement (64 KB max, DoS prevention)
- Rate limiting per `clientId` (sliding window)
- CRDT unit tests including convergence property test
- Bidirectional CRDT ↔ CodeMirror position mapper (cursor drift prevention)
- Snapshot trigger as an async background job (not inline with broadcast)

---

## Interview Reference

> "Explain how your conflict resolution works."

Two clients insert at position 5 simultaneously. Both record their left neighbour's ID as
`originId`. When either client receives the other's operation, `integrateInsert` finds the
insertion point by scanning right from the shared `originId` and skipping any chars with the
same origin that sort higher by `clientId`. Both clients end up with the same ordering.
No server. No locks. No version vector negotiation. Deterministic by construction.

> "Why can't you host the WebSocket server on Vercel?"

Vercel runs serverless functions — they execute per-request and are torn down immediately after.
WebSocket connections are stateful and long-lived. `RoomManager` holds `Map<roomId, Set<Client>>`
in memory; that state would vanish between invocations. Railway (and Render) support persistent
Node.js processes, which is what WebSocket servers require.
