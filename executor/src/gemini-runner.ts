/**
 * Runs code via the Gemini API (https://ai.google.dev/gemini-api/docs/code-execution)
 * instead of a real sandbox.
 *
 * - python: uses Gemini's native `codeExecution` tool, which really runs the
 *   code in Google's sandboxed backend.
 * - javascript / java: Gemini has no native sandbox for these, so the model
 *   is prompted to act as the runtime and predict stdout/stderr/exit code.
 *   This is a SIMULATION, not real execution — it can be wrong for timing,
 *   infinite loops, or subtle runtime behavior.
 */
import { SupportedLanguage, MAX_OUTPUT_BYTES } from "./languages.js";
import type { StreamCallback, DoneCallback, ErrorCallback } from "./types.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_REQUEST_TIMEOUT_MS = 30_000;

const LANGUAGE_LABELS: Record<SupportedLanguage, string> = {
  javascript: "JavaScript (Node.js 20)",
  python: "Python 3",
  java: "Java (OpenJDK 17)",
};

function truncate(text: string): string {
  if (Buffer.byteLength(text, "utf8") <= MAX_OUTPUT_BYTES) return text;
  return Buffer.from(text, "utf8").subarray(0, MAX_OUTPUT_BYTES).toString("utf8") + "\n...[output truncated at 50KB]";
}

interface GeminiPart {
  text?: string;
  codeExecutionResult?: { outcome?: string; output?: string };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] } }>;
  promptFeedback?: { blockReason?: string };
}

async function callGemini(body: Record<string, unknown>, signal: AbortSignal): Promise<GeminiResponse> {
  const res = await fetch(`${GEMINI_API_URL}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    throw Object.assign(new Error("Gemini rate limit exceeded — try again shortly"), { reason: "service-unavailable" });
  }
  if (!res.ok) {
    const text = await res.text();
    throw Object.assign(new Error(`Gemini request failed (${res.status}): ${text.slice(0, 300)}`), { reason: "service-unavailable" });
  }
  return (await res.json()) as GeminiResponse;
}

interface SimulatedResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  compileError: boolean;
}

export async function runViaGemini(
  language: SupportedLanguage,
  code: string,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback
): Promise<void> {
  if (!GEMINI_API_KEY) {
    onError("service-unavailable", "GEMINI_API_KEY is not configured on the executor service");
    return;
  }

  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);

  try {
    if (language === "python") {
      await runPython(code, onChunk, onDone, onError, controller.signal);
    } else {
      await runSimulated(language, code, onChunk, onDone, onError, controller.signal);
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      onError("timeout", `Execution timed out after ${GEMINI_REQUEST_TIMEOUT_MS / 1000} seconds`);
      return;
    }
    onError((err as { reason?: "service-unavailable" }).reason ?? "service-unavailable", (err as Error).message);
  } finally {
    clearTimeout(abortTimer);
  }
}

async function runPython(
  code: string,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback,
  signal: AbortSignal
): Promise<void> {
  const prompt =
    "Execute the following Python program exactly as written, using the code execution tool. " +
    "Do not modify, fix, or improve the code — run it as-is, including any bugs, and report the real result.\n\n" +
    "```python\n" + code + "\n```";

  const response = await callGemini(
    { contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ codeExecution: {} }] },
    signal
  );

  if (response.promptFeedback?.blockReason) {
    onError("service-unavailable", `Blocked by Gemini: ${response.promptFeedback.blockReason}`);
    return;
  }

  const parts = response.candidates?.[0]?.content?.parts ?? [];
  let stdout = "";
  let failed = false;
  let sawResult = false;

  for (const part of parts) {
    if (part.codeExecutionResult) {
      sawResult = true;
      stdout += part.codeExecutionResult.output ?? "";
      if (part.codeExecutionResult.outcome && part.codeExecutionResult.outcome !== "OUTCOME_OK") failed = true;
    }
  }

  if (!sawResult) {
    onError("service-unavailable", "Gemini did not execute the code");
    return;
  }

  if (stdout) onChunk(truncate(stdout), failed ? "stderr" : "stdout");

  if (failed) {
    onError("compile-error", "Execution failed");
    return;
  }
  onDone(0);
}

async function runSimulated(
  language: SupportedLanguage,
  code: string,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback,
  signal: AbortSignal
): Promise<void> {
  const prompt =
    `You are a precise ${LANGUAGE_LABELS[language]} runtime. Mentally execute the following program exactly as a real ` +
    `interpreter/compiler+runtime would, with no modifications. Report exactly what would be printed to stdout, what ` +
    `would go to stderr (compiler errors, uncaught exceptions, stack traces), and the process exit code (0 on success, ` +
    "non-zero otherwise). Set compileError to true only for a compile-time/syntax error. Return ONLY the JSON result, no commentary.\n\n" +
    "```\n" + code + "\n```";

  const response = await callGemini(
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            stdout: { type: "STRING" },
            stderr: { type: "STRING" },
            exitCode: { type: "INTEGER" },
            compileError: { type: "BOOLEAN" },
          },
          required: ["stdout", "stderr", "exitCode", "compileError"],
        },
      },
    },
    signal
  );

  if (response.promptFeedback?.blockReason) {
    onError("service-unavailable", `Blocked by Gemini: ${response.promptFeedback.blockReason}`);
    return;
  }

  const text = response.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let parsed: SimulatedResult;
  try {
    parsed = JSON.parse(text) as SimulatedResult;
  } catch {
    onError("service-unavailable", "Gemini returned a non-JSON response");
    return;
  }

  if (parsed.stdout) onChunk(truncate(parsed.stdout), "stdout");
  if (parsed.stderr) onChunk(truncate(parsed.stderr), "stderr");

  if (parsed.compileError) {
    onError("compile-error", (parsed.stderr ?? "").trim() || "Compilation failed");
    return;
  }
  onDone(parsed.exitCode ?? 0);
}
