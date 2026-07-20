import { createClient } from '@supabase/supabase-js';

/**
 * Supabase service-role client singleton.
 *
 * Env vars are validated at startup in server/src/index.ts (T030).
 * This module assumes they are already present and non-empty.
 */
export const supabase = createClient(
  process.env['SUPABASE_URL'] as string,
  process.env['SUPABASE_SERVICE_ROLE_KEY'] as string,
  { auth: { persistSession: false } },
);
