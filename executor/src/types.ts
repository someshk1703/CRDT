export type StreamCallback = (chunk: string, stream: "stdout" | "stderr") => void;
export type DoneCallback = (exitCode: number) => void;
export type ErrorCallback = (
  reason: "timeout" | "oom" | "compile-error" | "service-unavailable",
  message: string
) => void;
