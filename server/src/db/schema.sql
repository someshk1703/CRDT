-- Week 4: Supabase persistence schema
-- Run this DDL in your Supabase SQL editor (Project → SQL Editor → New query).

-- ─── rooms ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rooms (
  id         TEXT        PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── operations ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS operations (
  id         BIGSERIAL   PRIMARY KEY,
  room_id    TEXT        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  client_id  TEXT        NOT NULL,
  op_type    TEXT        NOT NULL CHECK (op_type IN ('insert', 'delete')),
  payload    JSONB       NOT NULL,  -- insert: full CRDTChar; delete: { charId: string }
  clock      BIGINT      NOT NULL,  -- Lamport clock extracted from the char/charId
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS operations_room_clock_idx
  ON operations (room_id, clock ASC);

-- ─── snapshots ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS snapshots (
  id               BIGSERIAL   PRIMARY KEY,
  room_id          TEXT        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  serialized_chars JSONB       NOT NULL,  -- full CRDTChar[] array including tombstones
  last_clock       BIGINT      NOT NULL,  -- clock of the last op included in this snapshot
  op_count         BIGINT      NOT NULL,  -- total ops included (informational)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS snapshots_room_clock_idx
  ON snapshots (room_id, last_clock DESC);

-- ─── Week 5 migration ────────────────────────────────────────────────────────

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS name     TEXT NOT NULL DEFAULT 'Untitled Room',
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'javascript',
  ADD COLUMN IF NOT EXISTS owner_id TEXT REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS room_members (
  user_id         TEXT        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  room_id         TEXT        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  last_visited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, room_id)
);

CREATE INDEX IF NOT EXISTS room_members_user_visited_idx
  ON room_members (user_id, last_visited_at DESC);

ALTER TABLE room_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own room memberships"
  ON room_members FOR SELECT
  USING (auth.uid()::text = user_id);
