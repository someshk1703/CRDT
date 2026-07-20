# Data Model: Week 4 — Supabase Persistence & Event-Sourcing

**Feature**: [spec.md](../spec.md)
**Branch**: `004-week4-supabase-persistence`
**Created**: 2026-07-20

---

## Database Schema

### Table: `rooms`

Represents a collaborative editing session. Created the first time a client joins a room that does not yet exist in the database.

```sql
CREATE TABLE rooms (
  id         TEXT        PRIMARY KEY,          -- matches the URL slug, e.g. "my-room"
  name       TEXT        NOT NULL DEFAULT '',  -- human-readable label (future use)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

| Column       | Type        | Notes                              |
|-------------|-------------|------------------------------------|
| `id`         | `TEXT`      | Primary key; URL-safe slug         |
| `name`       | `TEXT`      | Display name, defaults to empty    |
| `created_at` | `TIMESTAMPTZ` | Server-assigned creation time    |

---

### Table: `operations`

Append-only event log. Every CRDT operation that passes the server's rate-limit and validation is inserted here. Rows are **never updated or deleted**.

```sql
CREATE TABLE operations (
  id         BIGSERIAL   PRIMARY KEY,
  room_id    TEXT        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  client_id  TEXT        NOT NULL,               -- server-assigned UUID per connection
  op_type    TEXT        NOT NULL,               -- 'insert' | 'delete'
  payload    JSONB       NOT NULL,               -- full CRDTChar for insert; {charId} for delete
  clock      BIGINT      NOT NULL,               -- Lamport clock value from the op ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX operations_room_clock_idx ON operations (room_id, clock ASC);
```

| Column       | Type        | Notes                                         |
|-------------|-------------|-----------------------------------------------|
| `id`         | `BIGSERIAL` | Auto-increment; establishes global insert order |
| `room_id`    | `TEXT`      | FK to `rooms.id`                              |
| `client_id`  | `TEXT`      | Server-assigned UUID for the connection       |
| `op_type`    | `TEXT`      | `'insert'` or `'delete'`                     |
| `payload`    | `JSONB`     | For insert: `{id, value, originId, deleted}`; for delete: `{charId}` |
| `clock`      | `BIGINT`    | Lamport clock extracted from the char ID; used for ordering replay |
| `created_at` | `TIMESTAMPTZ` | DB-assigned timestamp                       |

**Invariants**:
- Rows are append-only; no `UPDATE` or `DELETE` is ever issued
- `payload` for an insert is a serialized `CRDTChar` object; for a delete it is `{ charId: string }`
- `clock` is extracted from the char ID format `"clientId:lamportTick"` at persist time

---

### Table: `snapshots`

Periodic checkpoints of the full document string. Written after every 100th operation. Used to bound catch-up replay cost: instead of replaying from op #1, load the latest snapshot then replay only the delta.

```sql
CREATE TABLE snapshots (
  id               BIGSERIAL   PRIMARY KEY,
  room_id          TEXT        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  serialized_chars JSONB       NOT NULL,    -- full CRDTChar[] array (id, value, originId, deleted) including tombstones
  last_clock       BIGINT      NOT NULL,    -- clock of the last op included in this snapshot
  op_count         BIGINT      NOT NULL,    -- total ops included (informational)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX snapshots_room_clock_idx ON snapshots (room_id, last_clock DESC);
```

| Column              | Type        | Notes                                                              |
|--------------------|-------------|--------------------------------------------------------------------|
| `id`               | `BIGSERIAL` | Auto-increment                                                     |
| `room_id`          | `TEXT`      | FK to `rooms.id`                                                   |
| `serialized_chars` | `JSONB`     | Full `CRDTChar[]` array serialized as JSON, including tombstones   |
| `last_clock`       | `BIGINT`    | Lamport clock of the last op in this snapshot                      |
| `op_count`         | `BIGINT`    | Number of ops in this snapshot (informational)                     |
| `created_at`       | `TIMESTAMPTZ` | DB-assigned timestamp                                            |

**Invariants**:
- A snapshot at `last_clock = N` means all ops with `clock <= N` are baked into `serialized_chars`
- During catch-up: deserialize `serialized_chars` into a fresh `RGADocument` via `loadFromChars()`, then query and replay only ops with `clock > last_clock`
- Snapshot creation failures are non-fatal; catch-up falls back to full op replay from op #1

---

## Entity Relationships

```
rooms (1) ──< operations (many)
rooms (1) ──< snapshots (many)
```

- One room has many operations (unbounded, append-only)
- One room has many snapshots (one per 100 ops threshold)
- Operations and snapshots belong to exactly one room

---

## In-Memory State (RoomManager)

The server also maintains in-memory state for active rooms:

| Field               | Type                      | Notes                                        |
|--------------------|---------------------------|----------------------------------------------|
| `rooms`             | `Map<roomId, Set<Client>>` | WebSocket clients per room                  |
| `opCount`           | `Map<roomId, number>`      | Running op count per room for snapshot trigger |
| `realtimeSubs`      | `Map<roomId, RealtimeChannel>` | Supabase Realtime subscriptions per room |

The `opCount` map is seeded from the database on first join (count of existing ops), then incremented in-memory on each new op. This avoids a COUNT query on every insert.

---

## Migration Notes

- No existing data to migrate — this is a greenfield persistence layer
- All existing in-memory behavior is preserved; persistence is additive
- The `rooms` table row is upserted on first client join (safe to call on every join)
