import { supabase } from './useSession';

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';

export interface RoomInfo {
  id: string;
  name: string;
  language: string;
  owner_id: string | null;
  created_at: string;
  last_visited_at?: string;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? '';
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

/** Create a new room. Returns the created room row. */
export async function createRoom(name?: string, language?: string): Promise<RoomInfo> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/rooms`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, language }),
  });
  if (!res.ok) throw new Error(`createRoom failed: ${res.status}`);
  return res.json() as Promise<RoomInfo>;
}

/** List the authenticated user's recent rooms. */
export async function listRooms(): Promise<RoomInfo[]> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/rooms`, { headers });
  if (!res.ok) throw new Error(`listRooms failed: ${res.status}`);
  const body = await res.json() as { rooms: RoomInfo[] };
  return body.rooms;
}

/** Fetch a single room by slug. Returns null on 404. */
export async function getRoom(slug: string): Promise<RoomInfo | null> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/rooms/${slug}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getRoom failed: ${res.status}`);
  return res.json() as Promise<RoomInfo>;
}

/** Rename a room. Returns updated { id, name }. */
export async function renameRoom(slug: string, name: string): Promise<{ id: string; name: string }> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/rooms/${slug}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`renameRoom failed: ${res.status}`);
  return res.json() as Promise<{ id: string; name: string }>;
}
