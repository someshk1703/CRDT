import { requireUser, applyCors } from './_lib/auth.js';
import { supabaseAdmin } from './_lib/supabaseAdmin.js';
import type { ApiRequest, ApiResponse } from './_lib/http.js';
import type { CRDTChar } from '../../shared/src/crdt.js';

const MAX_CHARS = 500_000;

function clockFromId(id: string): number {
  return parseInt(id.split(':').at(-1) ?? '0', 10);
}

/**
 * POST /api/snapshot { roomId, chars }
 *
 * Client-debounced persistence (~5-10s of editor inactivity, see Room.tsx).
 * Writes the full RGADocument state (including tombstones) so a late joiner's
 * /api/catchup call can restore it without replaying an operation log.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const user = await requireUser(req, res);
  if (!user) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const roomId = body['roomId'];
  const chars = body['chars'];

  if (typeof roomId !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(roomId)) {
    res.status(400).json({ error: 'Invalid roomId' });
    return;
  }
  if (!Array.isArray(chars) || chars.length > MAX_CHARS) {
    res.status(400).json({ error: 'chars must be an array (max 500,000 entries)' });
    return;
  }

  const typedChars = chars as CRDTChar[];
  const lastClock = typedChars.length > 0 ? Math.max(...typedChars.map((c) => clockFromId(c.id))) : 0;

  await supabaseAdmin.from('rooms').upsert({ id: roomId }, { onConflict: 'id', ignoreDuplicates: true });

  const { error } = await supabaseAdmin.from('snapshots').insert({
    room_id: roomId,
    serialized_chars: typedChars,
    last_clock: lastClock,
    op_count: typedChars.length,
  });

  if (error) { res.status(500).json({ error: error.message }); return; }

  res.status(204).end();
}
