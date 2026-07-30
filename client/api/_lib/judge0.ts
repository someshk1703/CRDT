/**
 * Judge0 CE proxy logic — self-contained (not shared with executor/ workspace)
 * so this Vercel function has no cross-workspace build dependency.
 */

export type SupportedLanguage = 'javascript' | 'python' | 'java';

export const LANGUAGE_IDS: Record<SupportedLanguage, number> = {
  javascript: 63, // Node.js 12.14.0
  python: 71,     // Python 3.8.1
  java: 62,       // OpenJDK 13.0.1
};

export const MAX_CODE_BYTES = 65_536; // 64 KB
export const MAX_OUTPUT_BYTES = 51_200; // 50 KB
export const EXECUTION_TIMEOUT_S = 10;

// Judge0 status IDs — https://ce.judge0.com/#statuses-and-languages-status-get
const STATUS_TIME_LIMIT_EXCEEDED = 5;
const STATUS_COMPILATION_ERROR = 6;
const STATUS_INTERNAL_ERROR = 13;
const STATUS_EXEC_FORMAT_ERROR = 14;

interface Judge0RawResult {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  exit_code: number | null;
  status: { id: number; description: string };
}

export type ExecReason = 'timeout' | 'oom' | 'compile-error' | 'service-unavailable';

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  reason?: ExecReason;
  message?: string;
}

function decodeBase64(value: string | null): string {
  return value ? Buffer.from(value, 'base64').toString('utf8') : '';
}

function truncate(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= MAX_OUTPUT_BYTES) return text;
  return Buffer.from(text, 'utf8').subarray(0, MAX_OUTPUT_BYTES).toString('utf8') + '\n...[output truncated at 50KB]';
}

/** Runs code via Judge0 CE with `wait=true` (single synchronous response — no streaming). */
export async function runViaJudge0(language: SupportedLanguage, code: string): Promise<ExecResult> {
  const apiKey = process.env['JUDGE0_API_KEY'];
  const apiUrl = (process.env['JUDGE0_API_URL'] ?? 'https://judge0-ce.p.rapidapi.com').replace(/\/$/, '');
  const apiHost = process.env['JUDGE0_API_HOST'] ?? 'judge0-ce.p.rapidapi.com';

  if (!apiKey) {
    return { ok: false, stdout: '', stderr: '', exitCode: -1, reason: 'service-unavailable', message: 'JUDGE0_API_KEY is not configured' };
  }

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), (EXECUTION_TIMEOUT_S + 5) * 1000);

  try {
    const res = await fetch(`${apiUrl}/submissions?base64_encoded=true&wait=true`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-RapidAPI-Key': apiKey,
        'X-RapidAPI-Host': apiHost,
      },
      body: JSON.stringify({
        language_id: LANGUAGE_IDS[language],
        source_code: Buffer.from(code, 'utf8').toString('base64'),
        cpu_time_limit: EXECUTION_TIMEOUT_S,
        wall_time_limit: EXECUTION_TIMEOUT_S + 2,
      }),
    });

    if (res.status === 429) {
      return { ok: false, stdout: '', stderr: '', exitCode: -1, reason: 'service-unavailable', message: 'Judge0 rate limit exceeded — try again shortly' };
    }
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, stdout: '', stderr: '', exitCode: -1, reason: 'service-unavailable', message: `Judge0 request failed (${res.status}): ${body.slice(0, 300)}` };
    }

    const result = (await res.json()) as Judge0RawResult;
    const stdout = truncate(decodeBase64(result.stdout));
    const stderr = truncate(decodeBase64(result.stderr));

    switch (result.status.id) {
      case STATUS_COMPILATION_ERROR:
        return { ok: false, stdout, stderr, exitCode: -1, reason: 'compile-error', message: decodeBase64(result.compile_output).trim() || 'Compilation failed' };
      case STATUS_TIME_LIMIT_EXCEEDED:
        return { ok: false, stdout, stderr, exitCode: -1, reason: 'timeout', message: `Execution timed out after ${EXECUTION_TIMEOUT_S} seconds` };
      case STATUS_INTERNAL_ERROR:
      case STATUS_EXEC_FORMAT_ERROR:
        return { ok: false, stdout, stderr, exitCode: -1, reason: 'service-unavailable', message: result.message ?? result.status.description };
      default:
        return { ok: true, stdout, stderr, exitCode: result.exit_code ?? 0 };
    }
  } catch (err) {
    const isAbort = (err as Error).name === 'AbortError';
    return {
      ok: false, stdout: '', stderr: '', exitCode: -1,
      reason: isAbort ? 'timeout' : 'service-unavailable',
      message: isAbort ? `Execution timed out after ${EXECUTION_TIMEOUT_S} seconds` : `Failed to reach Judge0: ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(abortTimer);
  }
}
