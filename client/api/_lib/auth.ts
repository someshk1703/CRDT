import { supabaseAdmin } from './supabaseAdmin';
import type { ApiRequest, ApiResponse } from './http';

export interface AuthUser {
  id: string;
  username: string;
  avatarUrl: string;
}

/**
 * Validate a Supabase JWT and return the authenticated user, or null if the
 * token is missing, expired, or otherwise invalid.
 */
export async function validateToken(token: string): Promise<AuthUser | null> {
  if (!token || token.trim() === '') return null;

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
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

/** Reads the Bearer token, validates it, and writes a 401 response if invalid. */
export async function requireUser(req: ApiRequest, res: ApiResponse): Promise<AuthUser | null> {
  const auth = (req.headers['authorization'] as string | undefined) ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const user = await validateToken(token);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return user;
}

/** Applies CORS headers restricted to ALLOWED_ORIGIN (falls back to reflecting the request Origin in local dev). */
export function applyCors(req: ApiRequest, res: ApiResponse): void {
  const requestOrigin = (req.headers['origin'] as string | undefined) ?? '';
  const allowedOrigin = process.env['ALLOWED_ORIGIN'];
  const origin = allowedOrigin ?? (requestOrigin || '*');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Vary', 'Origin');
}
