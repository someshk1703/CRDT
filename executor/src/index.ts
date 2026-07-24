import express, { Request, Response } from "express";
import { runInDocker } from "./docker-runner.js";
import { LANGUAGES, MAX_CODE_BYTES, SupportedLanguage } from "./languages.js";

const app = express();
app.use(express.json({ limit: "128kb" }));

const PORT = parseInt(process.env.PORT ?? "3002", 10);

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "crdt-executor" });
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

  runInDocker(
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
