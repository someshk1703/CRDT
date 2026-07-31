import { requireUser, applyCors } from '../_lib/auth.js';
import { createRoom, generateUniqueSlug, getRecentRoomsForUser, SUPPORTED_LANGUAGES } from '../_lib/rooms';
import type { ApiRequest, ApiResponse } from '../_lib/http.js';

/** GET /api/rooms — list the caller's recent rooms. POST /api/rooms — create a room. */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  const user = await requireUser(req, res);
  if (!user) return;

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body['name'] === 'string' && body['name'].trim() ? body['name'].trim() : 'Untitled Room';
    const language = typeof body['language'] === 'string' ? body['language'] : 'javascript';

    if (!SUPPORTED_LANGUAGES.has(language)) {
      res.status(422).json({ error: `Unsupported language: ${language}` });
      return;
    }

    const slug = await generateUniqueSlug();
    const room = await createRoom(slug, name, language, user.id);
    res.status(201).json(room);
    return;
  }

  if (req.method === 'GET') {
    const rooms = await getRecentRoomsForUser(user.id);
    res.status(200).json({ rooms });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}
