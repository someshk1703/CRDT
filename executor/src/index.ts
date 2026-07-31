import express, { Request, Response } from "express";
import { execFileSync } from "child_process";
import { runInDocker } from "./docker-runner.js";
import { runViaJudge0 } from "./judge0-runner.js";
import { runDirect } from "./direct-runner.js";
import { LANGUAGES, MAX_CODE_BYTES, SupportedLanguage } from "./languages.js";
import type { StreamCallback, DoneCallback, ErrorCallback } from "./types.js";

const app = express();
app.use(express.json({ limit: "128kb" }));

const PORT = parseInt(process.env.PORT ?? "3002", 10);

/** true if `docker info` succeeds (Docker daemon reachable, e.g. socket-mounted local dev) */
function isDockerAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

const DOCKER_AVAILABLE = isDockerAvailable();

// Prefer real per-request container sandboxing when Docker is reachable (local
// dev via docker-compose's mounted socket). Otherwise fall back to the hosted
// Judge0 sandbox (works anywhere, incl. Railway, no Docker daemon required).
// Only fall back further to unsandboxed direct execution if neither is usable —
// this should never happen outside a bare local dev machine with no Docker and
// no JUDGE0_API_KEY configured.
let runCode: (
  language: SupportedLanguage,
  code: string,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback
) => void;

if (DOCKER_AVAILABLE) {
  console.log("[executor] Docker available — using per-request container sandboxing");
  runCode = runInDocker;
} else if (process.env.JUDGE0_API_KEY) {
  console.log("[executor] Docker unavailable — using Judge0 CE hosted sandbox");
  runCode = runViaJudge0;
} else {
  console.warn("[executor] Docker unavailable and JUDGE0_API_KEY unset — falling back to UNSANDBOXED direct execution (dev only)");
  runCode = runDirect;
}

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "crdt-executor", runner: DOCKER_AVAILABLE ? "docker" : process.env.JUDGE0_API_KEY ? "judge0" : "direct" });
});

app.post("/execute", (req: Request, res: Response) => {
  const { language, code } = req.body as { language: unknown; code: unknown };

  // Validate language
  if (typeof language !== "string" || !(language in LANGUAGES)) {
    res.status(400).json({
      error: `Invalid language. Must be one of: ${Object.keys(LANGUAGES).join(", ")}`,
    });
    return;
  }

  // Validate code
  if (typeof code !== "string" || code.trim().length === 0) {
    res.status(400).json({ error: "code must be a non-empty string" });
    return;
  }

  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
    res.status(400).json({ error: "code exceeds 64 KB limit" });
    return;
  }

  // Stream the response
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();

  void runCode(
    language as SupportedLanguage,
    code,
    (chunk, stream) => {
      // Each chunk as a JSON line: { type: "output", chunk, stream }
      res.write(JSON.stringify({ type: "output", chunk, stream }) + "\n");
    },
    (exitCode) => {
      res.write(JSON.stringify({ type: "done", exitCode }) + "\n");
      res.end();
    },
    (reason, message) => {
      res.write(JSON.stringify({ type: "error", reason, message }) + "\n");
      res.end();
    }
  );
});

app.listen(PORT, () => {
  console.log(`[executor] Listening on port ${PORT}`);
});
