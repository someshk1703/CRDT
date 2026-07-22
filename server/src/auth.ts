import { supabase } from './db/supabase.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Subset of the Supabase User object we actually use. */
export interface AuthUser {
  id: string;
  username: string;
  avatarUrl: string;
}

// ─── validateToken ────────────────────────────────────────────────────────────

/**
 * Validate a Supabase JWT and return the authenticated user, or null if the
 * token is missing, expired, or otherwise invalid.
 *
 * Called once per WebSocket upgrade and per REST request — not per message.
 */
export async function validateToken(token: string): Promise<AuthUser | null> {
  if (!token || token.trim() === '') return null;

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;

    const meta = data.user.user_metadata as Record<string, unknown>;
    return {
      id: data.user.id,
      username: (meta['user_name'] as string | undefined) ?? (meta['name'] as string | undefined) ?? 'anonymous',
      avatarUrl: (meta['avatar_url'] as string | undefined) ?? '',
    };
  } catch {
    return null;
  }
}
