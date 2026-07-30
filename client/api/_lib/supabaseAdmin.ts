import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env['SUPABASE_URL'];
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'];

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars (set in Vercel project settings)');
}

/** Service-role client — bypasses RLS. Server-side only; never bundle into client code. */
export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
