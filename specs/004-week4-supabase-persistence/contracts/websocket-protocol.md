# API & Message Contracts: Week 4 — Supabase Persistence & Event-Sourcing

**Feature**: [spec.md](../spec.md)
**Branch**: `004-week4-supabase-persistence`
**Created**: 2026-07-20

---

## WebSocket Message Protocol Changes

### Backward Compatibility

All existing message types are **unchanged**:

| Type | Direction | Status |
|------|-----------|--------|
| `welcome` | Server → Client | Unchanged |
| `user-joined` | Server → Client | Unchanged |
| `user-left` | Server → Client | Unchanged |
| `crdt-insert` | Client → Server → Peers | Unchanged |
| `crdt-delete` | Client → Server → Peers | Unchanged |
| `presence` | Client → Server → Peers | Unchanged |
| `op` | Client → Server → Peers | Unchanged (legacy Week 1) |

### New: `catchup` Message (Server → Client)

Sent to a joining client **after** the `welcome` message and **before** any live operations are forwarded to that client. Carries the full operation history needed to reconstruct the document.

```typescript
interface CatchupMessage {
  type: 'catchup';
  roomId: string;
  userId: string;      // server-assigned userId (same as welcome message)
  snapshot: {
    chars: CRDTChar[];   // full RGADocument.chars[] array (including tombstones) serialized
    lastClock: number;   // Lamport clock of last included op
  } | null;
  ops: Array<{
    op_type: 'insert' | 'delete';
    payload: CRDTChar | { charId: string };  // insert: full CRDTChar; delete: { charId }
    clock: number;
  }>;
}
```

**Semantics**:
- `snapshot` is `null` when no snapshot exists for the room (replay all ops from beginning)
- When `snapshot` is non-null, `chars` contains the full internal CRDT state — pass directly to `doc.loadFromChars(snapshot.chars)` to restore CRDT state; then set editor content to `doc.getText()`
- `ops` contains only ops with `clock > snapshot.lastClock` when a snapshot is present
- `ops` is ordered by `clock` ascending
- After restoring from snapshot, client replays `ops` via `doc.remoteInsert` / `doc.remoteDelete` — origin references in delta ops are valid because `loadFromChars` restores the full chars array including tombstones
- Client MUST NOT buffer or re-apply live ops that arrived before catch-up completes — CRDT idempotency (`remoteInsert` ignores duplicate IDs) handles any overlap

**Client handling**:
```
on receive 'catchup':
  1. if snapshot != null:
       doc.loadFromChars(snapshot.chars)   // restores full CRDT state
       set editor content to doc.getText()
  2. for each op in ops (in order):
       - if op.op_type === 'insert': doc.remoteInsert(op.payload as CRDTChar)
       - if op.op_type === 'delete': doc.remoteDelete((op.payload as {charId}).charId)
  3. sync editor view to doc.getText()
  4. mark catch-up complete; flush any buffered live ops
```

---

## Server Internal APIs

### `persistOp(roomId, clientId, msg)`

Inserts a single operation into the `operations` table.

```typescript
async function persistOp(
  roomId: string,
  clientId: string,
  msg: CRDTInsertMessage | CRDTDeleteMessage,
): Promise<void>
```

- Upserts the room row first (idempotent, noop if room already exists)
- Extracts `clock` from `char.id` for insert ops; sets `clock = 0` for deletes (deletes reference an existing charId, not a new clock position)
- On failure: logs error, does NOT broadcast the op (consistency over availability per FR-001)
- Called in the message handler before `roomManager.broadcast()`

### `loadOpsForRoom(roomId)`

Returns the latest snapshot (if any) and all delta operations for catch-up.

```typescript
async function loadOpsForRoom(roomId: string): Promise<{
  snapshot: { content: string; lastClock: number } | null;
  ops: Array<{ op_type: string; payload: object; clock: number }>;
}>
```

- Queries `snapshots` for the latest row by `last_clock DESC LIMIT 1`
- Queries `operations` for all rows where `clock > snapshot.lastClock` (or all ops if no snapshot)
- Returns ops ordered by `clock ASC`

### `maybeSaveSnapshot(roomId, document, opCount)`

Writes a snapshot if the op count has crossed a 100-op threshold.

```typescript
async function maybeSaveSnapshot(
  roomId: string,
  document: RGADocument,
  opCount: number,
): Promise<void>
```

- Only writes if `opCount % SNAPSHOT_INTERVAL === 0`
- `SNAPSHOT_INTERVAL` defaults to `100`; configurable via `SNAPSHOT_INTERVAL` env var
- Failure is non-fatal; logs a warning and continues

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (bypasses RLS; server-side only) |
| `SNAPSHOT_INTERVAL` | No | Ops between snapshots; defaults to `100` |
| `PORT` | No | HTTP/WS port; defaults to `3001` |

**Security**: `SUPABASE_SERVICE_ROLE_KEY` is a secret. It MUST be loaded from environment variables, never hardcoded or committed. Add to `.env` (which is gitignored).

---

## New File Structure

```
server/src/
├── db/
│   ├── supabase.ts       # Supabase client singleton
│   ├── operations.ts     # persistOp(), loadOpsForRoom(), maybeSaveSnapshot()
│   └── schema.sql        # CREATE TABLE statements (apply manually in Supabase dashboard)
├── index.ts              # Updated: persist on message, send catchup on join
└── room-manager.ts       # Updated: add opCount map and realtimeSubs map
shared/src/
└── index.ts              # Updated: add CatchupMessage interface
client/src/hooks/
└── useCRDT.ts            # Updated: handle 'catchup' message type
```

---

## Supabase Realtime Subscription Contract

Each room's first client join triggers a Realtime subscription:

```typescript
supabase
  .channel(`room-ops:${roomId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    schema: 'public',
    table: 'operations',
    filter: `room_id=eq.${roomId}`,
  }, (payload) => {
    // Reconstruct message from payload.new and broadcast to WS clients
    const op = payload.new;
    const wsMsg = op.op_type === 'insert'
      ? { type: 'crdt-insert', ...op.payload }
      : { type: 'crdt-delete', ...op.payload };
    roomManager.broadcast(roomId, wsMsg);
  })
  .subscribe();
```

**Notes**:
- Subscription is per room, per server instance
- Subscription is created on first client join; unsubscribed when the room becomes empty
- For local dev with a single instance, both the direct broadcast AND the Realtime callback will fire — this causes duplicate delivery. Mitigations:
  - **Option A** (recommended for local dev): Disable the Realtime broadcast path; keep direct broadcast only
  - **Option B** (production mode): Remove direct broadcast; rely solely on Realtime for all fan-out
  - The CRDT's `remoteInsert` idempotency prevents corruption if both paths fire simultaneously, but it's cleaner to use one path

Implement the Realtime subscription as a separate, toggleable path controlled by `ENABLE_REALTIME_BROADCAST=true` env var.
