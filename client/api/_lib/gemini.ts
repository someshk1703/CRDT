/**
 * Runs code via the Gemini API instead of a real sandbox. Self-contained (not
 * shared with executor/ workspace) so this Vercel function has no
 * cross-workspace build dependency.
 *
 * - python: uses Gemini's native `codeExecution` tool, which really runs the
 *   code in Google's sandboxed backend (https://ai.google.dev/gemini-api/docs/code-execution).
 * - javascript / java: Gemini has no native sandbox for these, so the model
 *   is prompted to act as the runtime and predict stdout/stderr/exit code.
 *   This is a SIMULATION, not real execution — it can be wrong for timing,
 *   infinite loops, or subtle runtime behavior.
 */

export type SupportedLanguage = 'javascript' | 'python' | 'java';

export const LANGUAGE_IDS: Record<SupportedLanguage, number> = {
  javascript: 63,
  python: 71,
  java: 62,
};

export const MAX_CODE_BYTES = 65_536; // 64 KB
export const MAX_OUTPUT_BYTES = 51_200; // 50 KB
export const EXECUTION_TIMEOUT_S = 10;

const GEMINI_REQUEST_TIMEOUT_MS = 30_000;
const GEMINI_MODEL = process.env['GEMINI_MODEL'] ?? 'gemini-2.5-flash';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  javascript: 'JavaScript (Node.js 20)',
  python: 'Python 3',
  java: 'Java (OpenJDK 17)',
};

export type ExecReason = 'timeout' | 'oom' | 'compile-error' | 'service-unavailable';

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  reason?: ExecReason;
  message?: string;
}

function truncate(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= MAX_OUTPUT_BYTES) return text;
  return Buffer.from(text, 'utf8').subarray(0, MAX_OUTPUT_BYTES).toString('utf8') + '\n...[output truncated at 50KB]';
}

interface GeminiPart {
  text?: string;
  executableCode?: { language?: string; code?: string };
  codeExecutionResult?: { outcome?: string; output?: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

async function callGemini(apiKey: string, body: Record<string, unknown>, signal: AbortSignal): Promise<GeminiResponse> {
  const res = await fetch(`${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    throw Object.assign(new Error('Gemini rate limit exceeded — try again shortly'), { reason: 'service-unavailable' as ExecReason });
  }
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`Gemini request failed (${res.status}): ${text.slice(0, 300)}`), { reason: 'service-unavailable' as ExecReason });
  }
  return (await res.json()) as GeminiResponse;
}

/** Runs Python via Gemini's real sandboxed code execution tool. */
async function runPython(apiKey: string, code: string, signal: AbortSignal): Promise<ExecResult> {
  const prompt =
    'Execute the following Python program exactly as written, using the code execution tool. ' +
    'Do not modify, fix, or improve the code — run it as-is, including any bugs, and report the real result.\n\n' +
    '```python\n' + code + '\n```';

  const response = await callGemini(
    apiKey,
    { contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ codeExecution: {} }] },
    signal
  );

  if (response.promptFeedback?.blockReason) {
    return { ok: false, stdout: '', stderr: '', exitCode: -1, reason: 'service-unavailable', message: `Blocked by Gemini: ${response.promptFeedback.blockReason}` };
  }

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  let stdout = '';
  let failed = false;
  let sawResult = false;

  for (const part of parts) {
    if (part.codeExecutionResult) {
      sawResult = true;
      stdout += part.codeExecutionResult.output ?? '';
      if (part.codeExecutionResult.outcome && part.codeExecutionResult.outcome !== 'OUTCOME_OK') failed = true;
    }
  }

  if (!sawResult) {
    // Model didn't invoke the tool — fall back to any text it returned, best-effort.
    const text = parts.map((p) => p.text ?? '').join('');
    return { ok: false, stdout: truncate(text), stderr: '', exitCode: -1, reason: 'service-unavailable', message: 'Gemini did not execute the code' };
  }

  return failed
    ? { ok: false, stdout: '', stderr: truncate(stdout), exitCode: 1, reason: 'compile-error', message: 'Execution failed' }
    : { ok: true, stdout: truncate(stdout), stderr: '', exitCode: 0 };
}

interface SimulatedResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  compileError: boolean;
}

/** Simulates running JS/Java by asking Gemini to act as the runtime and predict output. */
async function runSimulated(apiKey: string, language: SupportedLanguage, code: string, signal: AbortSignal): Promise<ExecResult> {
  const prompt =
    `You are a precise ${LANGUAGE_LABELS[language]} runtime. Mentally execute the following program exactly as a real ` +
    `interpreter/compiler+runtime would, with no modifications. Report exactly what would be printed to stdout, what ` +
    `would go to stderr (compiler errors, uncaught exceptions, stack traces), and the process exit code (0 on success, ` +
    'non-zero otherwise). Set compileError to true only for a compile-time/syntax error. Return ONLY the JSON result, no commentary.\n\n' +
    '```\n' + code + '\n```';

  const response = await callGemini(
    apiKey,
    {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            stdout: { type: 'STRING' },
            stderr: { type: 'STRING' },
            exitCode: { type: 'INTEGER' },
            compileError: { type: 'BOOLEAN' },
          },
          required: ['stdout', 'stderr', 'exitCode', 'compileError'],
        },
      },
    },
    signal
  );

  if (response.promptFeedback?.blockReason) {
    return { ok: false, stdout: '', stderr: '', exitCode: -1, reason: 'service-unavailable', message: `Blocked by Gemini: ${response.promptFeedback.blockReason}` };
  }

  const text = response.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  let parsed: SimulatedResult;
  try {
    parsed = JSON.parse(text) as SimulatedResult;
  } catch {
    return { ok: false, stdout: '', stderr: '', exitCode: -1, reason: 'service-unavailable', message: 'Gemini returned a non-JSON response' };
  }

  if (parsed.compileError) {
    return { ok: false, stdout: truncate(parsed.stdout ?? ''), stderr: truncate(parsed.stderr ?? ''), exitCode: parsed.exitCode || 1, reason: 'compile-error', message: (parsed.stderr ?? '').trim() || 'Compilation failed' };
  }
  return { ok: true, stdout: truncate(parsed.stdout ?? ''), stderr: truncate(parsed.stderr ?? ''), exitCode: parsed.exitCode ?? 0 };
}

/** Runs code via Gemini — real sandboxed execution for Python, simulated for JS/Java. */
export async function runViaGemini(language: SupportedLanguage, code: string): Promise<ExecResult> {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    return { ok: false, stdout: '', stderr: '', exitCode: -1, reason: 'service-unavailable', message: 'GEMINI_API_KEY is not configured' };
  }

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);

  try {
    return language === 'python'
      ? await runPython(apiKey, code, controller.signal)
      : await runSimulated(apiKey, language, code, controller.signal);
  } catch (err) {
    const isAbort = (err as Error).name === 'AbortError';
    return {
      ok: false, stdout: '', stderr: '', exitCode: -1,
      reason: isAbort ? 'timeout' : (err as { reason?: ExecReason }).reason ?? 'service-unavailable',
      message: isAbort ? `Execution timed out after ${GEMINI_REQUEST_TIMEOUT_MS / 1000} seconds` : (err as Error).message,
    };
  } finally {
    clearTimeout(abortTimer);
  }
}
