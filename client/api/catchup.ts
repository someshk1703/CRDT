import { requireUser, applyCors } from './_lib/auth';
import { getRoomBySlug } from './_lib/rooms';
import { supabaseAdmin } from './_lib/supabaseAdmin';
import type { ApiRequest, ApiResponse } from './_lib/http';
import type { CRDTChar } from '../../shared/src/crdt';

/**
 * GET /api/catchup?roomId=xxx
 *
 * Returns the latest persisted snapshot (if any) plus the room's current
 * language, so a joining client can `RGADocument.loadFromChars(...)` before
 * subscribing to the Supabase Realtime broadcast channel. Broadcast itself is
 * ephemeral (no history), so this snapshot is the only source of past state.
 */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const user = await requireUser(req, res);
  if (!user) return;

  const roomId = req.query['roomId'];
  if (typeof roomId !== 'string' || !/^[a-z0-9-]{1,64}$/i.test(roomId)) {
    res.status(400).json({ error: 'Invalid roomId' });
    return;
  }

  const [room, snapResult] = await Promise.all([
    getRoomBySlug(roomId),
    supabaseAdmin
      .from('snapshots')
      .select('serialized_chars')
      .eq('room_id', roomId)
      .order('last_clock', { ascending: false })
      .limit(1),
  ]);

  if (snapResult.error) {
    res.status(500).json({ error: snapResult.error.message });
    return;
  }

  const chars = (snapResult.data?.[0]?.['serialized_chars'] as CRDTChar[] | undefined) ?? null;

  res.status(200).json({
    snapshot: chars ? { chars } : null,
    currentLanguage: room?.language ?? 'javascript',
  });
}
