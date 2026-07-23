import type { CRDTChar, RGADocument } from '@crdt/shared/crdt';
import { supabase } from './supabase.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PersistedOp {
  op_type: 'insert' | 'delete';
  payload: CRDTChar | { charId: string };
  clock: number;
}

export interface SnapshotRow {
  chars: CRDTChar[];
  lastClock: number;
}

export interface LoadResult {
  snapshot: SnapshotRow | null;
  ops: PersistedOp[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function clockFromId(id: string): number {
  return parseInt(id.split(':').at(-1) ?? '0', 10);
}

// ─── persistOp ───────────────────────────────────────────────────────────────

/**
 * Upsert the room row then append the operation to the `operations` table.
 * Throws on Supabase error so the caller can abort the broadcast.
 */
export async function persistOp(
  roomId: string,
  clientId: string,
  msg: Record<string, unknown>,
): Promise<void> {
  // Ensure room exists
  const { error: roomErr } = await supabase
    .from('rooms')
    .upsert({ id: roomId }, { onConflict: 'id', ignoreDuplicates: true });

  if (roomErr) {
    console.error(`[db] persistOp room upsert failed room=${roomId}:`, roomErr.message);
    throw roomErr;
  }

  let op_type: 'insert' | 'delete';
  let payload: CRDTChar | { charId: string };
  let clock: number;

  if (msg['type'] === 'crdt-insert') {
    const char = msg['char'] as CRDTChar;
    op_type = 'insert';
    payload = char;
    clock = clockFromId(char.id);
  } else {
    const charId = msg['charId'] as string;
    op_type = 'delete';
    payload = { charId };
    clock = clockFromId(charId);
  }

  const { error: opErr } = await supabase
    .from('operations')
    .insert({ room_id: roomId, client_id: clientId, op_type, payload, clock });

  if (opErr) {
    console.error(`[db] persistOp insert failed room=${roomId} op=${op_type}:`, opErr.message);
    throw opErr;
  }
}

// ─── loadOpsForRoom ───────────────────────────────────────────────────────────

/**
 * Load the latest snapshot (if any) and all delta ops since that snapshot.
 * Returns `{ snapshot, ops }` where `ops` is ordered by clock ASC.
 */
export async function loadOpsForRoom(roomId: string): Promise<LoadResult> {
  // Fetch the most recent snapshot
  const { data: snapRows, error: snapErr } = await supabase
    .from('snapshots')
    .select('serialized_chars, last_clock')
    .eq('room_id', roomId)
    .order('last_clock', { ascending: false })
    .limit(1);

  if (snapErr) {
    console.error(`[db] loadOpsForRoom snapshot query failed room=${roomId}:`, snapErr.message);
    throw snapErr;
  }

  const snapRow = snapRows?.[0] ?? null;
  const snapshot: SnapshotRow | null = snapRow
    ? { chars: snapRow.serialized_chars as CRDTChar[], lastClock: snapRow.last_clock as number }
    : null;

  const sinceClockExclusive = snapshot?.lastClock ?? -1;

  // Fetch delta ops
  const { data: opsRows, error: opsErr } = await supabase
    .from('operations')
    .select('op_type, payload, clock')
    .eq('room_id', roomId)
    .gt('clock', sinceClockExclusive)
    .order('clock', { ascending: true });

  if (opsErr) {
    console.error(`[db] loadOpsForRoom ops query failed room=${roomId}:`, opsErr.message);
    throw opsErr;
  }

  const ops: PersistedOp[] = (opsRows ?? []).map((row) => ({
    op_type: row.op_type as 'insert' | 'delete',
    payload: row.payload as CRDTChar | { charId: string },
    clock: row.clock as number,
  }));

  return { snapshot, ops };
}

// ─── maybeSaveSnapshot ────────────────────────────────────────────────────────

/**
 * When `opCount % SNAPSHOT_INTERVAL === 0`, serialize the server-side
 * RGADocument's full chars array (including tombstones) as JSONB and persist it.
 * Failures are non-fatal — logged but not thrown.
 */
export async function maybeSaveSnapshot(
  roomId: string,
  doc: RGADocument,
  opCount: number,
): Promise<void> {
  const interval = parseInt(process.env['SNAPSHOT_INTERVAL'] ?? '100', 10);
  if (opCount % interval !== 0) return;

  const chars = doc.getChars();
  const lastClock = chars.length > 0
    ? Math.max(...chars.map((c: CRDTChar) => clockFromId(c.id)))
    : 0;

  const { error } = await supabase.from('snapshots').insert({
    room_id: roomId,
    serialized_chars: chars,
    last_clock: lastClock,
    op_count: opCount,
  });

  if (error) {
    console.error(`[db] maybeSaveSnapshot failed room=${roomId}:`, error.message);
    // Non-fatal — catch-up falls back to full op replay
  } else {
    console.log(`[db] snapshot saved room=${roomId} opCount=${opCount} lastClock=${lastClock}`);
  }
}

// ─── Week 5: room management helpers ─────────────────────────────────────────

export interface RoomRow {
  id: string;
  name: string;
  language: string;
  owner_id: string | null;
  created_at: string;
}

export interface RecentRoom extends RoomRow {
  last_visited_at: string;
}

/** Insert a new room row. Throws on conflict (slug already exists). */
export async function createRoom(
  slug: string,
  name: string,
  language: string,
  ownerId: string,
): Promise<RoomRow> {
  const { data, error } = await supabase
    .from('rooms')
    .insert({ id: slug, name, language, owner_id: ownerId })
    .select('id, name, language, owner_id, created_at')
    .single();

  if (error) {
    console.error(`[db] createRoom failed slug=${slug}:`, error.message);
    throw error;
  }
  return data as RoomRow;
}

/** Fetch a single room by slug. Returns null if not found. */
export async function getRoomBySlug(slug: string): Promise<RoomRow | null> {
  const { data, error } = await supabase
    .from('rooms')
    .select('id, name, language, owner_id, created_at')
    .eq('id', slug)
    .maybeSingle();

  if (error) {
    console.error(`[db] getRoomBySlug failed slug=${slug}:`, error.message);
    throw error;
  }
  return data as RoomRow | null;
}

/** Upsert a room row without throwing if it already exists (used on WS join). */
export async function upsertRoom(
  slug: string,
  ownerId: string,
  language = 'javascript',
): Promise<void> {
  const { error } = await supabase
    .from('rooms')
    .upsert(
      { id: slug, owner_id: ownerId, language },
      { onConflict: 'id', ignoreDuplicates: true },
    );
  if (error) console.error(`[db] upsertRoom failed slug=${slug}:`, error.message);
}

/** Record or refresh a user's membership in a room. */
export async function upsertRoomMember(userId: string, roomId: string): Promise<void> {
  const { error } = await supabase
    .from('room_members')
    .upsert(
      { user_id: userId, room_id: roomId, last_visited_at: new Date().toISOString() },
      { onConflict: 'user_id,room_id' },
    );
  if (error) console.error(`[db] upsertRoomMember failed user=${userId} room=${roomId}:`, error.message);
}

/** List up to 10 rooms the user has visited, most recent first. */
export async function getRecentRoomsForUser(userId: string): Promise<RecentRoom[]> {
  const { data, error } = await supabase
    .from('room_members')
    .select('last_visited_at, rooms(id, name, language, owner_id, created_at)')
    .eq('user_id', userId)
    .order('last_visited_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error(`[db] getRecentRoomsForUser failed user=${userId}:`, error.message);
    throw error;
  }

  return (data ?? []).map((row: Record<string, unknown>) => {
    const room = row['rooms'] as RoomRow;
    return { ...room, last_visited_at: row['last_visited_at'] as string };
  });
}

/** Persist a language change on the room record. */
export async function updateRoomLanguage(roomId: string, lang: string): Promise<void> {
  const { error } = await supabase
    .from('rooms')
    .update({ language: lang })
    .eq('id', roomId);
  if (error) console.error(`[db] updateRoomLanguage failed room=${roomId}:`, error.message);
}

/** Update a room's name and return the updated row. */
export async function updateRoomName(roomId: string, name: string): Promise<{ id: string; name: string }> {
  const { data, error } = await supabase
    .from('rooms')
    .update({ name })
    .eq('id', roomId)
    .select('id, name')
    .single();
  if (error) {
    console.error(`[db] updateRoomName failed room=${roomId}:`, error.message);
    throw error;
  }
  return data as { id: string; name: string };
}

