/**
 * Direct execution fallback for local dev when neither Docker nor Judge0 is
 * available. Runs code via child_process without sandboxing — DEV ONLY.
 */
import { spawn } from "child_process";
import { SupportedLanguage, EXECUTION_TIMEOUT_MS, MAX_OUTPUT_BYTES } from "./languages.js";
import type { StreamCallback, DoneCallback, ErrorCallback } from "./types.js";
import { tmpdir } from "os";
import { join } from "path";
import { writeFileSync, mkdirSync } from "fs";

function spawnDirect(
  cmd: string,
  args: string[],
  stdin: string | null,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback,
): void {
  const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });

  let outputBytes = 0;
  let truncated = false;
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, EXECUTION_TIMEOUT_MS);

  if (stdin !== null) {
    child.stdin.write(stdin);
  }
  child.stdin.end();

  child.stdout.on("data", (data: Buffer) => {
    if (truncated) return;
    const chunk = data.toString("utf8");
    outputBytes += Buffer.byteLength(chunk, "utf8");
    if (outputBytes > MAX_OUTPUT_BYTES) {
      truncated = true;
      onChunk("\n...[output truncated at 50KB]", "stdout");
      return;
    }
    onChunk(chunk, "stdout");
  });

  child.stderr.on("data", (data: Buffer) => {
    if (!truncated) onChunk(data.toString("utf8"), "stderr");
  });

  child.on("close", (code: number | null) => {
    clearTimeout(timeout);
    if (timedOut) {
      onError("timeout", "Execution timed out after 10 seconds");
      return;
    }
    onDone(code ?? 1);
  });

  child.on("error", (err) => {
    clearTimeout(timeout);
    onError("service-unavailable", `Failed to spawn process: ${err.message}`);
  });
}

export function runDirect(
  language: SupportedLanguage,
  code: string,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback,
): void {
  onChunk("⚠️  [DEV MODE — no sandbox]\n", "stderr");

  if (language === "javascript") {
    spawnDirect("node", ["-e", code], null, onChunk, onDone, onError);
  } else if (language === "python") {
    spawnDirect("python3", ["-c", code], null, onChunk, onDone, onError);
  } else if (language === "java") {
    // Write to temp file, compile, run
    const dir = join(tmpdir(), `crdt-java-${Date.now()}`);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "Main.java"), code, "utf8");
    } catch (err) {
      onError("service-unavailable", `Failed to write temp file: ${String(err)}`);
      return;
    }

    const javac = spawn("javac", [join(dir, "Main.java"), "-d", dir], { stdio: ["pipe", "pipe", "pipe"] });
    let compileErr = "";
    javac.stderr.on("data", (d: Buffer) => { compileErr += d.toString(); });
    javac.stdout.on("data", (d: Buffer) => { compileErr += d.toString(); });
    javac.on("close", (code) => {
      if (code !== 0) {
        onError("compile-error", compileErr.trim() || "Compilation failed");
        return;
      }
      spawnDirect("java", ["-cp", dir, "Main"], null, onChunk, onDone, onError);
    });
    javac.on("error", () => {
      onError("service-unavailable", "java/javac not found. Install JDK to run Java.");
    });
  }
}
