import { randomBytes } from 'crypto';
import { supabaseAdmin } from './supabaseAdmin.js';

// ─── Types ────────────────────────────────────────────────────────────────────

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

export const SUPPORTED_LANGUAGES = new Set([
  'javascript', 'typescript', 'python', 'java', 'go', 'html', 'css', 'json',
]);

// ─── Slug generation ──────────────────────────────────────────────────────────

const SLUG_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const SLUG_LENGTH = 10;

function randomSlug(): string {
  const bytes = randomBytes(SLUG_LENGTH);
  let out = '';
  for (const b of bytes) out += SLUG_ALPHABET[b % SLUG_ALPHABET.length];
  return out;
}

/** Generate a slug that does not yet exist in the rooms table. */
export async function generateUniqueSlug(): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = randomSlug();
    const existing = await getRoomBySlug(slug);
    if (!existing) return slug;
  }
  // Astronomically unlikely at demo scale — last attempt, accept the collision risk.
  return randomSlug();
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getRoomBySlug(slug: string): Promise<RoomRow | null> {
  const { data, error } = await supabaseAdmin
    .from('rooms')
    .select('id, name, language, owner_id, created_at')
    .eq('id', slug)
    .maybeSingle();
  if (error) throw error;
  return data as RoomRow | null;
}

export async function createRoom(
  slug: string,
  name: string,
  language: string,
  ownerId: string,
): Promise<RoomRow> {
  const { data, error } = await supabaseAdmin
    .from('rooms')
    .insert({ id: slug, name, language, owner_id: ownerId })
    .select('id, name, language, owner_id, created_at')
    .single();
  if (error) throw error;
  return data as RoomRow;
}

/** List up to 10 rooms the user has visited, most recent first. */
export async function getRecentRoomsForUser(userId: string): Promise<RecentRoom[]> {
  const { data, error } = await supabaseAdmin
    .from('room_members')
    .select('last_visited_at, rooms(id, name, language, owner_id, created_at)')
    .eq('user_id', userId)
    .order('last_visited_at', { ascending: false })
    .limit(10);
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => {
    const room = row['rooms'] as RoomRow;
    return { ...room, last_visited_at: row['last_visited_at'] as string };
  });
}

export async function updateRoomName(roomId: string, name: string): Promise<{ id: string; name: string }> {
  const { data, error } = await supabaseAdmin
    .from('rooms')
    .update({ name })
    .eq('id', roomId)
    .select('id, name')
    .single();
  if (error) throw error;
  return data as { id: string; name: string };
}

export async function updateRoomLanguage(roomId: string, lang: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('rooms')
    .update({ language: lang })
    .eq('id', roomId);
  if (error) throw error;
}

/**
 * Eviction policy: an owner may only keep `maxRooms` rooms at a time. Once a
 * new room pushes them over the cap, the oldest excess rooms are deleted
 * (cascades to room_members/operations/snapshots via FK ON DELETE CASCADE).
 * Non-fatal — logged but never thrown, so it can't block room creation.
 */
export async function enforceRoomLimit(ownerId: string, maxRooms = 3): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('rooms')
    .select('id, created_at')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(`[db] enforceRoomLimit query failed owner=${ownerId}:`, error.message);
    return;
  }

  const excess = (data ?? []).slice(maxRooms);
  if (excess.length === 0) return;

  const evictIds = excess.map((row) => row['id'] as string);
  const { error: delError } = await supabaseAdmin.from('rooms').delete().in('id', evictIds);
  if (delError) {
    console.error(`[db] enforceRoomLimit delete failed owner=${ownerId}:`, delError.message);
  }
}

/** Record or refresh a user's membership in a room; seeds the room row if missing. */
export async function upsertRoomMember(userId: string, roomId: string): Promise<void> {
  await supabaseAdmin.from('rooms').upsert({ id: roomId }, { onConflict: 'id', ignoreDuplicates: true });
  const { error } = await supabaseAdmin
    .from('room_members')
    .upsert(
      { user_id: userId, room_id: roomId, last_visited_at: new Date().toISOString() },
      { onConflict: 'user_id,room_id' },
    );
  if (error) throw error;
}
