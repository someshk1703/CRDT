/**
 * Runs code via Judge0 CE (https://ce.judge0.com), a hosted sandboxed
 * execution API — see https://rapidapi.com/judge0-official/api/judge0-ce.
 */
import { LANGUAGES, SupportedLanguage, EXECUTION_TIMEOUT_MS, MAX_OUTPUT_BYTES } from "./languages.js";
import type { StreamCallback, DoneCallback, ErrorCallback } from "./types.js";

const JUDGE0_API_URL = (process.env.JUDGE0_API_URL ?? "https://judge0-ce.p.rapidapi.com").replace(/\/$/, "");
const JUDGE0_API_KEY = process.env.JUDGE0_API_KEY;
const JUDGE0_API_HOST = process.env.JUDGE0_API_HOST ?? "judge0-ce.p.rapidapi.com";

// Judge0 status IDs — https://ce.judge0.com/#statuses-and-languages-status-get
const STATUS_TIME_LIMIT_EXCEEDED = 5;
const STATUS_COMPILATION_ERROR = 6;
const STATUS_INTERNAL_ERROR = 13;
const STATUS_EXEC_FORMAT_ERROR = 14;

interface Judge0Result {
  stdout: string | null;
  stderr: string | null;
  compile_output: string | null;
  message: string | null;
  exit_code: number | null;
  status: { id: number; description: string };
}

function decodeBase64(value: string | null): string {
  return value ? Buffer.from(value, "base64").toString("utf8") : "";
}

function truncate(text: string): string {
  if (Buffer.byteLength(text, "utf8") <= MAX_OUTPUT_BYTES) return text;
  return Buffer.from(text, "utf8").subarray(0, MAX_OUTPUT_BYTES).toString("utf8") + "\n...[output truncated at 50KB]";
}

export async function runViaJudge0(
  language: SupportedLanguage,
  code: string,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback
): Promise<void> {
  if (!JUDGE0_API_KEY) {
    onError("service-unavailable", "JUDGE0_API_KEY is not configured on the executor service");
    return;
  }

  // Judge0's own run_timeout bounds execution; abort the HTTP call a little later
  // to allow for network/queueing overhead before we give up client-side.
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), EXECUTION_TIMEOUT_MS + 5_000);

  try {
    const res = await fetch(`${JUDGE0_API_URL}/submissions?base64_encoded=true&wait=true`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-RapidAPI-Key": JUDGE0_API_KEY,
        "X-RapidAPI-Host": JUDGE0_API_HOST,
      },
      body: JSON.stringify({
        language_id: LANGUAGES[language].judge0Id,
        source_code: Buffer.from(code, "utf8").toString("base64"),
        cpu_time_limit: EXECUTION_TIMEOUT_MS / 1000,
        wall_time_limit: EXECUTION_TIMEOUT_MS / 1000 + 2,
      }),
    });

    if (res.status === 429) {
      onError("service-unavailable", "Judge0 rate limit exceeded — try again shortly");
      return;
    }
    if (!res.ok) {
      const body = await res.text();
      onError("service-unavailable", `Judge0 request failed (${res.status}): ${body.slice(0, 300)}`);
      return;
    }

    const result = (await res.json()) as Judge0Result;
    const stdout = truncate(decodeBase64(result.stdout));
    const stderr = truncate(decodeBase64(result.stderr));

    if (stdout) onChunk(stdout, "stdout");
    if (stderr) onChunk(stderr, "stderr");

    switch (result.status.id) {
      case STATUS_COMPILATION_ERROR:
        onError("compile-error", decodeBase64(result.compile_output).trim() || "Compilation failed");
        return;
      case STATUS_TIME_LIMIT_EXCEEDED:
        onError("timeout", `Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000} seconds`);
        return;
      case STATUS_INTERNAL_ERROR:
      case STATUS_EXEC_FORMAT_ERROR:
        onError("service-unavailable", result.message ?? result.status.description);
        return;
      default:
        onDone(result.exit_code ?? 0);
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      onError("timeout", `Execution timed out after ${EXECUTION_TIMEOUT_MS / 1000} seconds`);
      return;
    }
    onError("service-unavailable", `Failed to reach Judge0: ${(err as Error).message}`);
  } finally {
    clearTimeout(abortTimer);
  }
}
