import { supabase } from './useSession';

// Same-origin by default — Vercel serves the SPA and /api/* routes from one
// project. Override VITE_API_URL only if the API is deployed separately.
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export interface RoomInfo {
  id: string;
  name: string;
  language: string;
  owner_id: string | null;
  created_at: string;
  last_visited_at?: string;
}

export async function authHeaders(): Promise<Record<string, string>> {
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
  const res = await fetch(`${API_BASE}/api/rooms`, {
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
  const res = await fetch(`${API_BASE}/api/rooms`, { headers });
  if (!res.ok) throw new Error(`listRooms failed: ${res.status}`);
  const body = await res.json() as { rooms: RoomInfo[] };
  return body.rooms;
}

/** Fetch a single room by slug. Returns null on 404. */
export async function getRoom(slug: string): Promise<RoomInfo | null> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/rooms/${slug}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getRoom failed: ${res.status}`);
  return res.json() as Promise<RoomInfo>;
}

/** Rename a room. Returns updated { id, name }. */
export async function renameRoom(slug: string, name: string): Promise<{ id: string; name: string }> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/rooms/${slug}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`renameRoom failed: ${res.status}`);
  return res.json() as Promise<{ id: string; name: string }>;
}

// ─── Catch-up + snapshot persistence (serverless CRDT sync) ─────────────────

export interface CatchupResult {
  snapshot: { chars: import('@crdt/shared/crdt').CRDTChar[] } | null;
  currentLanguage: string;
}

/** Fetch the last persisted snapshot for a room, applied before subscribing to Realtime broadcast. */
export async function getCatchup(roomId: string): Promise<CatchupResult> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/catchup?roomId=${encodeURIComponent(roomId)}`, { headers });
  if (!res.ok) throw new Error(`getCatchup failed: ${res.status}`);
  return res.json() as Promise<CatchupResult>;
}

/** Debounced full-document snapshot persistence (~7s after the user stops typing). */
export async function saveSnapshot(roomId: string, chars: import('@crdt/shared/crdt').CRDTChar[]): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/snapshot`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ roomId, chars }),
  });
  if (!res.ok) throw new Error(`saveSnapshot failed: ${res.status}`);
}

// ─── Code execution proxy ────────────────────────────────────────────────────

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  reason?: 'timeout' | 'oom' | 'compile-error' | 'service-unavailable' | 'quota';
  message?: string;
  remaining?: number;
}

/** Runs code via the quota-checked /api/execute Judge0 proxy. Never throws for expected failures (quota, Judge0 errors) — check `result.ok`. */
export async function executeCode(roomId: string, language: string, code: string): Promise<ExecResult> {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/execute`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ roomId, language, code }),
  });
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;

  if (res.status === 429) {
    return {
      ok: false, stdout: '', stderr: '', exitCode: -1, reason: 'quota',
      message: (body['error'] as string) ?? 'Daily execution limit reached (50/day). Resets at midnight UTC.',
    };
  }
  if (!res.ok) {
    return {
      ok: false, stdout: '', stderr: '', exitCode: -1, reason: 'service-unavailable',
      message: (body['error'] as string) ?? `Execution request failed (${res.status})`,
    };
  }
  return body as unknown as ExecResult;
}
