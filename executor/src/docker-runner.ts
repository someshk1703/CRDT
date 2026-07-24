import { spawn } from "child_process";
import {
  LANGUAGES,
  SupportedLanguage,
  EXECUTION_TIMEOUT_MS,
  MAX_OUTPUT_BYTES,
} from "./languages.js";

export type StreamCallback = (chunk: string, stream: "stdout" | "stderr") => void;
export type DoneCallback = (exitCode: number) => void;
export type ErrorCallback = (
  reason: "timeout" | "oom" | "compile-error" | "service-unavailable",
  message: string
) => void;

/**
 * Runs code inside a locked-down Docker container.
 * Streams stdout/stderr via onChunk; signals completion via onDone or onError.
 */
export function runInDocker(
  language: SupportedLanguage,
  code: string,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback
): void {
  const config = LANGUAGES[language];

  if (language === "java") {
    runJava(code, config.image, onChunk, onDone, onError);
  } else {
    runSingleStep(language, code, config.image, onChunk, onDone, onError);
  }
}

function buildDockerBaseArgs(image: string): string[] {
  return [
    "run",
    "--rm",
    "--network=none",
    "--memory=64m",
    "--cpus=0.5",
    "--read-only",
    "--user=nobody",
    "--tmpfs=/tmp:size=10m",
    image,
  ];
}

function runSingleStep(
  language: SupportedLanguage,
  code: string,
  image: string,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback
): void {
  const langCmd =
    language === "javascript"
      ? ["node", "-e", code]
      : ["python3", "-c", code];

  const args = [...buildDockerBaseArgs(image), ...langCmd];

  spawnWithLimits(args, onChunk, onDone, onError);
}

function runJava(
  code: string,
  image: string,
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback
): void {
  // Two-step: write to /tmp/Main.java, javac, then java
  // We pass code via stdin to avoid shell injection; use a wrapper command
  const shellScript = [
    "sh",
    "-c",
    // Write code to a temp file, compile, and run.
    // `cat` reads from stdin so we can pipe code in safely.
    "mkdir -p /tmp/exec && cat > /tmp/exec/Main.java && javac /tmp/exec/Main.java -d /tmp/exec 2>&1; JAVAC_EXIT=$?; if [ $JAVAC_EXIT -ne 0 ]; then echo \"__COMPILE_ERROR__\" >&2; exit $JAVAC_EXIT; fi && java -cp /tmp/exec Main",
  ];

  const baseArgs = buildDockerBaseArgs(image);
  // Replace last element (image) approach — insert --interactive to accept stdin
  const args = [
    "run",
    "--rm",
    "--network=none",
    "--memory=64m",
    "--cpus=0.5",
    "--read-only",
    "--user=nobody",
    "--tmpfs=/tmp:size=32m",
    "--interactive",
    image,
    ...shellScript,
  ];

  const child = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });

  let outputBytes = 0;
  let truncated = false;
  let timedOut = false;
  let compileError = false;
  let stderrBuffer = "";

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, EXECUTION_TIMEOUT_MS);

  // Write code to stdin
  child.stdin.write(code);
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
    const chunk = data.toString("utf8");
    stderrBuffer += chunk;
    if (!truncated) {
      onChunk(chunk, "stderr");
    }
  });

  child.on("close", (code: number | null) => {
    clearTimeout(timeout);

    if (timedOut) {
      onError("timeout", "Execution timed out after 10 seconds");
      return;
    }

    const exitCode = code ?? 1;

    if (exitCode === 137) {
      onError("oom", "Execution killed: memory limit exceeded (64 MB)");
      return;
    }

    // Detect compile error from our sentinel in stderr
    if (stderrBuffer.includes("__COMPILE_ERROR__")) {
      const compileMsg = stderrBuffer.replace("__COMPILE_ERROR__\n", "").trim();
      onError("compile-error", compileMsg || "Compilation failed");
      return;
    }

    onDone(exitCode);
  });

  child.on("error", (err: Error) => {
    clearTimeout(timeout);
    onError("service-unavailable", `Failed to spawn Docker: ${err.message}`);
  });
}

function spawnWithLimits(
  args: string[],
  onChunk: StreamCallback,
  onDone: DoneCallback,
  onError: ErrorCallback
): void {
  const child = spawn("docker", args, { stdio: ["ignore", "pipe", "pipe"] });

  let outputBytes = 0;
  let truncated = false;
  let timedOut = false;

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, EXECUTION_TIMEOUT_MS);

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
    if (!truncated) {
      onChunk(data.toString("utf8"), "stderr");
    }
  });

  child.on("close", (code: number | null) => {
    clearTimeout(timeout);

    if (timedOut) {
      onError("timeout", "Execution timed out after 10 seconds");
      return;
    }

    const exitCode = code ?? 1;

    if (exitCode === 137) {
      onError("oom", "Execution killed: memory limit exceeded (64 MB)");
      return;
    }

    onDone(exitCode);
  });

  child.on("error", (err: Error) => {
    clearTimeout(timeout);
    onError("service-unavailable", `Failed to spawn Docker: ${err.message}`);
  });
}
