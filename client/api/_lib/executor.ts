/**
 * Proxies execution to the self-hosted VPS executor (real Docker sandboxing,
 * see executor/src/docker-runner.ts) instead of Judge0. Self-contained (not
 * shared with executor/ workspace) so this Vercel function has no
 * cross-workspace build dependency.
 */
import type { SupportedLanguage, ExecResult } from './judge0.js';
import { EXECUTION_TIMEOUT_S, MAX_OUTPUT_BYTES } from './judge0.js';

interface ExecutorLine {
  type: 'output' | 'done' | 'error';
  chunk?: string;
  stream?: 'stdout' | 'stderr';
  exitCode?: number;
  reason?: ExecResult['reason'];
  message?: string;
}

function truncate(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= MAX_OUTPUT_BYTES) return text;
  return Buffer.from(text, 'utf8').subarray(0, MAX_OUTPUT_BYTES).toString('utf8') + '\n...[output truncated at 50KB]';
}

/** Runs code via the self-hosted executor's streaming NDJSON `/execute` endpoint, aggregated into a single result. */
export async function runViaExecutor(language: SupportedLanguage, code: string): Promise<ExecResult> {
  const executorUrl = process.env['EXECUTOR_URL'];
  const authToken = process.env['EXECUTOR_AUTH_TOKEN'];

  if (!executorUrl) {
    return { ok: false, stdout: '', stderr: '', exitCode: -1, reason: 'service-unavailable', message: 'EXECUTOR_URL is not configured' };
  }

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), (EXECUTION_TIMEOUT_S + 5) * 1000);

  let stdout = '';
  let stderr = '';

  try {
    const res = await fetch(`${executorUrl.replace(/\/$/, '')}/execute`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ language, code }),
    });

    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      return { ok: false, stdout: '', stderr: '', exitCode: -1, reason: 'service-unavailable', message: `Executor request failed (${res.status}): ${body.slice(0, 300)}` };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.trim()) continue;

        const parsed = JSON.parse(line) as ExecutorLine;
        if (parsed.type === 'output') {
          if (parsed.stream === 'stderr') stderr += parsed.chunk ?? '';
          else stdout += parsed.chunk ?? '';
        } else if (parsed.type === 'done') {
          return { ok: true, stdout: truncate(stdout), stderr: truncate(stderr), exitCode: parsed.exitCode ?? 0 };
        } else if (parsed.type === 'error') {
          return { ok: false, stdout: truncate(stdout), stderr: truncate(stderr), exitCode: -1, reason: parsed.reason, message: parsed.message };
        }
      }
    }

    // Stream ended without a terminal "done"/"error" line.
    return { ok: false, stdout: truncate(stdout), stderr: truncate(stderr), exitCode: -1, reason: 'service-unavailable', message: 'Executor closed the connection unexpectedly' };
  } catch (err) {
    const isAbort = (err as Error).name === 'AbortError';
    return {
      ok: false, stdout: truncate(stdout), stderr: truncate(stderr), exitCode: -1,
      reason: isAbort ? 'timeout' : 'service-unavailable',
      message: isAbort ? `Execution timed out after ${EXECUTION_TIMEOUT_S} seconds` : `Failed to reach executor: ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(abortTimer);
  }
}
