export type SupportedLanguage = "javascript" | "python" | "java";

export interface LanguageConfig {
  /** Judge0 CE language_id — see https://ce.judge0.com/#statuses-and-languages-language-get */
  judge0Id: number;
  /** Docker image used for local sandboxed execution (docker-runner.ts). */
  image: string;
  /** Java needs a compile step before it can run. */
  twoStep?: boolean;
}

export const LANGUAGES: Record<SupportedLanguage, LanguageConfig> = {
  javascript: {
    judge0Id: 63, // JavaScript (Node.js 12.14.0)
    image: "node:20-alpine",
  },
  python: {
    judge0Id: 71, // Python (3.8.1)
    image: "python:3.12-slim",
  },
  java: {
    judge0Id: 62, // Java (OpenJDK 13.0.1)
    image: "openjdk:17-alpine",
    twoStep: true,
  },
};

export const MAX_CODE_BYTES = 65_536; // 64 KB
export const MAX_OUTPUT_BYTES = 51_200; // 50 KB
export const EXECUTION_TIMEOUT_MS = 10_000; // 10 seconds

