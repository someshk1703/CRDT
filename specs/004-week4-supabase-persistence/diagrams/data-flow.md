# Data Flow: Week 4 — Persistence & Catch-up

Shows how data moves through the system for the two primary Week 4 flows.

---

## Flow 1: Op Persistence (Happy Path)

How a keystroke travels from the editor to durable storage and to all peers.

```mermaid
sequenceDiagram
    participant C as Client A (editor)
    participant S as Server
    participant DB as Supabase DB

    C->>S: crdt-insert { char: {id, value, originId} }
    S->>S: validate + rate-limit
    S->>DB: INSERT into operations
    DB-->>S: ok
    S->>C: broadcast crdt-insert to all peers in room
    Note over DB: If op count % 100 == 0
    S->>DB: INSERT into snapshots
```

---

## Flow 2: New Client Catch-up

How a brand-new client gets the full document state on joining a room.

```mermaid
sequenceDiagram
    participant B as Client B (new tab)
    participant S as Server
    participant DB as Supabase DB

    B->>S: WebSocket connect /room/<roomId>
    S->>B: welcome { userId, color }
    S->>DB: SELECT latest snapshot for roomId
    DB-->>S: { content, lastClock } or null
    S->>DB: SELECT ops WHERE clock > lastClock ORDER BY clock ASC
    DB-->>S: [ op1, op2, ... ]
    S->>B: catchup { snapshot, ops }
    Note over B: Replay snapshot content,<br/>then each op in order
    B->>B: RGADocument reconstructed
    B->>B: Editor renders full document
    Note over S,B: Live ops now flow normally
```

---

## Flow 3: Catch-up / Live-stream Boundary

Race condition: a live op arrives at the server while catch-up is being assembled.

```mermaid
sequenceDiagram
    participant A as Client A (already in room)
    participant S as Server
    participant DB as Supabase DB
    participant B as Client B (joining)

    S->>DB: SELECT ops for catch-up
    Note over A,S: While query is running...
    A->>S: crdt-insert { char: op_N+1 }
    S->>DB: INSERT op_N+1
    S->>B: direct broadcast op_N+1 (client B may not be ready yet)
    DB-->>S: catch-up ops [op_1 ... op_N]
    Note over S: op_N+1 NOT in catch-up batch (was inserted after query)
    S->>B: catchup { ops: [op_1 ... op_N] }
    Note over B: Replays op_1 ... op_N
    Note over B: op_N+1 already queued or arrives as live
    B->>B: remoteInsert(op_N+1) — idempotent, safe if already applied
```

**Key insight**: CRDT idempotency (`remoteInsert` silently ignores duplicate IDs) makes this race safe without additional synchronization. No buffering or sequence numbering required.
