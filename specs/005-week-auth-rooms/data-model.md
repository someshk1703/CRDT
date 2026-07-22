# Data Model: Week 5 — Auth, Rooms, and Polished UX

**Feature**: [spec.md](./spec.md)
**Branch**: `005-week-auth-rooms`
**Created**: 2026-07-22

---

## Schema Changes (additive — no existing tables modified destructively)

### Table: `rooms` — updated

Two new columns added. Existing rows default correctly.

```sql
ALTER TABLE rooms
  ADD COLUMN language TEXT NOT NULL DEFAULT 'javascript',
  ADD COLUMN owner_id TEXT REFERENCES auth.users(id) ON DELETE SET NULL;
```

Full updated schema for reference:

```sql
CREATE TABLE rooms (
  id         TEXT        PRIMARY KEY,             -- URL-safe nanoid slug, e.g. "a3f9x7k2mq"
  name       TEXT        NOT NULL DEFAULT 'Untitled Room',
  language   TEXT        NOT NULL DEFAULT 'javascript',  -- current editor language for the room
  owner_id   TEXT        REFERENCES auth.users(id) ON DELETE SET NULL,  -- creator's Supabase user ID
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

| Column       | Type          | Notes                                                           |
|-------------|---------------|-----------------------------------------------------------------|
| `id`         | `TEXT`        | Primary key; URL-safe nanoid slug (length 10)                   |
| `name`       | `TEXT`        | Human-readable room name; defaults to `'Untitled Room'`         |
| `language`   | `TEXT`        | Active editor language; one of the 7 supported language IDs     |
| `owner_id`   | `TEXT`        | FK to `auth.users(id)`; null if owner's account is deleted      |
| `created_at` | `TIMESTAMPTZ` | Server-assigned creation timestamp                              |

**Supported language values**: `'javascript'` · `'typescript'` · `'python'` · `'java'` · `'go'` · `'html'` · `'css'` · `'json'`

---

### Table: `room_members` — new

Tracks which users have joined which rooms and when they last visited. Drives the "recent rooms" list on the home page.

```sql
CREATE TABLE room_members (
  user_id         TEXT        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id         TEXT        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  last_visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, room_id)
);

CREATE INDEX room_members_user_visited_idx ON room_members (user_id, last_visited_at DESC);
```

| Column             | Type          | Notes                                                         |
|-------------------|---------------|---------------------------------------------------------------|
| `user_id`          | `TEXT`        | FK to `auth.users(id)`; identifies the authenticated user     |
| `room_id`          | `TEXT`        | FK to `rooms(id)`                                             |
| `last_visited_at`  | `TIMESTAMPTZ` | Updated on every join; used for "recent rooms" ordering       |

**Upsert pattern**: On every WebSocket join, upsert with `ON CONFLICT (user_id, room_id) DO UPDATE SET last_visited_at = now()`.

---

## Entity Relationships (full picture)

```
auth.users (1) ──< room_members (many)  (a user visits many rooms)
rooms      (1) ──< room_members (many)  (a room has many members)
rooms      (1) ──< operations  (many)   (unchanged from Week 4)
rooms      (1) ──< snapshots   (many)   (unchanged from Week 4)
auth.users (1) ──< rooms.owner_id       (a user owns many rooms)
```

---

## In-Memory State (RoomManager) — updated

The `RoomManager` now carries authenticated user metadata per connected client:

| Field               | Type                                       | Notes                                                                   |
|--------------------|--------------------------------------------|-------------------------------------------------------------------------|
| `rooms`             | `Map<roomId, Set<Client>>`                 | WebSocket clients per room (unchanged)                                  |
| `opCount`           | `Map<roomId, number>`                      | Running op count per room (unchanged)                                   |
| `realtimeSubs`      | `Map<roomId, RealtimeChannel>`             | Supabase Realtime subscriptions (unchanged)                             |
| `clientMeta`        | `Map<ws, ClientMeta>`                      | **New** — authenticated user info keyed by WebSocket instance           |

```typescript
interface ClientMeta {
  userId: string;      // Supabase user ID (from JWT)
  username: string;    // GitHub username (from user_metadata.user_name)
  avatarUrl: string;   // GitHub avatar URL (from user_metadata.avatar_url)
  roomId: string;      // Room the client is connected to
}
```

The `clientMeta` map is populated at upgrade time (after JWT validation) and cleared on `close`/`error`. It replaces the anonymous UUID-based identity used in prior weeks.

---

## Row-Level Security (RLS) Notes

| Table          | Read Policy                                  | Write Policy                                              |
|---------------|----------------------------------------------|-----------------------------------------------------------|
| `rooms`        | Any authenticated user can read              | Only owner or service role can insert/update              |
| `room_members` | User can read their own rows                 | Service role only (server upserts on join)                |
| `operations`   | Any authenticated user can read (catch-up)   | Service role only (server inserts)                        |
| `snapshots`    | Any authenticated user can read              | Service role only (server inserts)                        |

All server-side DB operations continue to use the `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS). Client-side Supabase calls (auth flow, session management) use the anon key.

---

## Migration Script

```sql
-- Week 5 migration: Auth, rooms, and polished UX
-- Run in Supabase SQL editor

-- 1. Extend rooms table
ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'javascript',
  ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES auth.users(id) ON DELETE SET NULL;

-- 2. Create room_members join table
CREATE TABLE IF NOT EXISTS room_members (
  user_id         TEXT        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id         TEXT        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  last_visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, room_id)
);

CREATE INDEX IF NOT EXISTS room_members_user_visited_idx
  ON room_members (user_id, last_visited_at DESC);

-- 3. Enable RLS on new table
ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;

-- Allow users to read their own membership rows
CREATE POLICY "Users can read own room memberships"
  ON room_members FOR SELECT
  USING (auth.uid()::text = user_id);
```
