import http from "http";
import https from "https";

/**
 * HTTP client for the executor microservice.
 * Streams execution output back via callbacks.
 */

export type ChunkCallback = (chunk: string, stream: "stdout" | "stderr") => void;
export type DoneCallback = (exitCode: number) => void;
export type ErrorCallback = (
  reason: "timeout" | "oom" | "compile-error" | "service-unavailable",
  message: string
) => void;

const EXECUTOR_URL = process.env["EXECUTOR_URL"] ?? "http://localhost:3002";
const MAX_CODE_BYTES = 65_536;

export function streamExecution(
  language: string,
  code: string,
  roomId: string,
  onChunk: ChunkCallback,
  onDone: DoneCallback,
  onError: ErrorCallback
): void {
  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
    onError("service-unavailable", "Code exceeds 64 KB limit");
    return;
  }

  const body = JSON.stringify({ language, code, roomId });
  const urlObj = new URL(`${EXECUTOR_URL}/execute`);
  const isHttps = urlObj.protocol === "https:";

  const options: http.RequestOptions = {
    hostname: urlObj.hostname,
    port: urlObj.port || (isHttps ? "443" : "80"),
    path: urlObj.pathname,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
  };

  const transport = isHttps ? https : http;

  const req = transport.request(options, (res) => {
    let buffer = "";

    res.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");

      // NDJSON: split on newlines, process complete lines
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep incomplete last line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as {
            type: string;
            chunk?: string;
            stream?: string;
            exitCode?: number;
            reason?: string;
            message?: string;
          };

          if (msg.type === "output") {
            onChunk(
              msg.chunk ?? "",
              (msg.stream === "stderr" ? "stderr" : "stdout") as "stdout" | "stderr"
            );
          } else if (msg.type === "done") {
            onDone(msg.exitCode ?? 0);
          } else if (msg.type === "error") {
            onError(
              (msg.reason ?? "service-unavailable") as Parameters<ErrorCallback>[0],
              msg.message ?? "Unknown error"
            );
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    });

    res.on("end", () => {
      // Handle any remaining buffered content
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer) as { type: string; exitCode?: number };
          if (msg.type === "done") onDone(msg.exitCode ?? 0);
        } catch {
          // ignore
        }
      }
    });
  });

  req.on("error", (err: Error) => {
    const code = (err as NodeJS.ErrnoException).code;
    const isConnRefused = code === "ECONNREFUSED" || code === "ENOTFOUND";
    onError(
      "service-unavailable",
      isConnRefused
        ? "Execution service is unavailable"
        : `Execution request failed: ${err.message}`
    );
  });

  req.write(body);
  req.end();
}
