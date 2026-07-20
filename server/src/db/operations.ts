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
