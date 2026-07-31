import { createHash } from 'crypto';
import { requireUser, applyCors } from './_lib/auth.js';
import { supabaseAdmin } from './_lib/supabaseAdmin.js';
import { runViaJudge0, MAX_CODE_BYTES, LANGUAGE_IDS, type SupportedLanguage } from './_lib/judge0.js';
import { runViaExecutor } from './_lib/executor.js';
import type { ApiRequest, ApiResponse } from './_lib/http.js';

/**
 * Global (first-come-first-served) daily cap shared across all users — this
 * mirrors the 50/day limit RapidAPI enforces on the account itself.
 */
const DAILY_LIMIT = 50;
const CACHE_TTL_MS = 60_000;

function startOfTodayUTC(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** POST /api/execute { roomId, language, code } — quota-checked Judge0 proxy. */
export default async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
  applyCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const user = await requireUser(req, res);
  if (!user) return;

  const body = (req.body ?? {}) as Record<string, unknown>;
  const language = body['language'];
  const code = body['code'];

  if (typeof language !== 'string' || !(language in LANGUAGE_IDS)) {
    res.status(400).json({ error: `Invalid language. Must be one of: ${Object.keys(LANGUAGE_IDS).join(', ')}` });
    return;
  }
  if (typeof code !== 'string' || code.trim().length === 0) {
    res.status(400).json({ error: 'code must be a non-empty string' });
    return;
  }
  if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
    res.status(400).json({ error: 'code exceeds 64 KB limit' });
    return;
  }

  // ── Global daily quota (first-come-first-served across all users) ────────
  const { count, error: countErr } = await supabaseAdmin
    .from('executions')
    .select('*', { count: 'exact', head: true })
    .gte('created_at', startOfTodayUTC().toISOString());

  if (countErr) { res.status(500).json({ error: countErr.message }); return; }
  const used = count ?? 0;

  if (used >= DAILY_LIMIT) {
    res.status(429).json({ error: 'Daily execution limit reached (50/day). Resets at midnight UTC.', remaining: 0 });
    return;
  }

  // ── Cache: skip Judge0 + quota burn for an identical recent submission ───
  const hash = createHash('sha256').update(`${language}:${code}`).digest('hex');
  const { data: cached } = await supabaseAdmin
    .from('execution_cache')
    .select('result, created_at')
    .eq('hash', hash)
    .maybeSingle();

  if (cached && Date.now() - new Date(cached['created_at'] as string).getTime() < CACHE_TTL_MS) {
    res.status(200).json({ ...(cached['result'] as object), cached: true, remaining: DAILY_LIMIT - used });
    return;
  }

  // Prefer the self-hosted VPS executor (real Docker sandbox) when configured;
  // fall back to Judge0 CE if EXECUTOR_URL isn't set or the executor errors out
  // with 'service-unavailable' (host down, box rebooting, etc.).
  let result = process.env['EXECUTOR_URL']
    ? await runViaExecutor(language as SupportedLanguage, code)
    : await runViaJudge0(language as SupportedLanguage, code);

  if (!result.ok && result.reason === 'service-unavailable' && process.env['EXECUTOR_URL']) {
    result = await runViaJudge0(language as SupportedLanguage, code);
  }

  // Every real execution (success or failure) counts against the shared quota.
  await supabaseAdmin.from('executions').insert({ user_id: user.id, created_at: new Date().toISOString() });

  if (result.ok) {
    await supabaseAdmin.from('execution_cache').upsert({ hash, result, created_at: new Date().toISOString() });
  }

  res.status(200).json({ ...result, cached: false, remaining: DAILY_LIMIT - used - 1 });
}
