# System Architecture: Week 4 — Supabase Persistence

How the system components fit together after adding persistence.

```mermaid
graph TD
    subgraph Client["Browser Client"]
        CM[CodeMirror Editor]
        CRDT[RGADocument]
        WS_CLIENT[WebSocket Hook]
        CATCHUP[Catch-up Handler]
    end

    subgraph Server["Node.js Server (ws)"]
        WS_SERVER[WebSocket Server]
        RM[RoomManager<br/>in-memory]
        PERSIST[db/operations.ts<br/>persistOp / loadOps / snapshot]
        REALTIME[Supabase Realtime<br/>Subscription per room]
    end

    subgraph Supabase["Supabase (Postgres + Realtime)"]
        ROOMS[(rooms)]
        OPS[(operations)]
        SNAPS[(snapshots)]
        RT[Realtime Engine]
    end

    CM -->|local edit| CRDT
    CRDT -->|crdt-insert / crdt-delete| WS_CLIENT
    WS_CLIENT -->|JSON over WS| WS_SERVER

    WS_SERVER -->|validate + rate-limit| PERSIST
    PERSIST -->|INSERT| OPS
    PERSIST -->|UPSERT| ROOMS
    PERSIST -->|INSERT on 100th op| SNAPS
    OPS -->|INSERT event| RT
    RT -->|postgres_changes| REALTIME

    REALTIME -->|broadcast to WS clients| RM
    WS_SERVER -->|direct broadcast to peers| RM

    WS_SERVER -->|on join: loadOpsForRoom| PERSIST
    PERSIST -->|SELECT snapshot + ops| OPS
    PERSIST -->|SELECT latest snapshot| SNAPS
    WS_SERVER -->|catchup message| WS_CLIENT
    WS_CLIENT --> CATCHUP
    CATCHUP -->|remoteInsert / remoteDelete| CRDT
    CRDT -->|setText| CM
```

## Component Responsibilities

| Component | Responsibility |
|-----------|---------------|
| `RGADocument` | CRDT state; unchanged by Week 4 |
| `useCRDT` hook | Local→op, remote op→editor; gains `catchup` message handling |
| `db/supabase.ts` | Supabase client singleton (service role) |
| `db/operations.ts` | All DB reads and writes; isolated from transport logic |
| `RoomManager` | WebSocket client registry; gains op count tracking |
| Supabase Realtime | Cross-instance op fan-out (toggled by env var) |

## Deployment Targets

- **Local dev**: Node.js `tsx watch`, Supabase local dev or cloud free tier
- **Production** (Week 5): Railway (server) + Vercel (client) + Supabase cloud
