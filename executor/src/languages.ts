export type SupportedLanguage = "javascript" | "python" | "java";

export interface LanguageConfig {
  image: string;
  twoStep?: boolean;
}

export const LANGUAGES: Record<SupportedLanguage, LanguageConfig> = {
  javascript: {
    image: "node:20-alpine",
  },
  python: {
    image: "python:3.12-slim",
  },
  java: {
    image: "openjdk:17-alpine",
    twoStep: true,
  },
};

export const MAX_CODE_BYTES = 65_536; // 64 KB
export const MAX_OUTPUT_BYTES = 51_200; // 50 KB
export const EXECUTION_TIMEOUT_MS = 10_000; // 10 seconds
