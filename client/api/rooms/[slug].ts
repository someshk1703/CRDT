import { requireUser, applyCors } from '../_lib/auth.js';
import { getRoomBySlug, updateRoomName } from '../_lib/rooms.js';
import type { ApiRequest, ApiResponse } from '../_lib/http.js';

const SLUG_RE = /^[a-z0-9]{1,64}$/i;

/** GET /api/rooms/:slug — fetch a room. PATCH /api/rooms/:slug — rename a room. */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const slug = req.query['slug'];
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    res.status(400).json({ error: 'Invalid room slug' });
    return;
  }

  const user = await requireUser(req, res);
  if (!user) return;

  try {
    if (req.method === 'GET') {
      const room = await getRoomBySlug(slug);
      if (!room) { res.status(404).json({ error: 'Room not found' }); return; }
      res.status(200).json(room);
      return;
    }

    if (req.method === 'PATCH') {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
      if (!name) { res.status(400).json({ error: 'name must be a non-empty string' }); return; }

      const room = await getRoomBySlug(slug);
      if (!room) { res.status(404).json({ error: 'Room not found' }); return; }

      const updated = await updateRoomName(slug, name);
      res.status(200).json(updated);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('api/rooms/[slug] error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
}
