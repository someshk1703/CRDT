import { describe, it, expect } from "vitest";
import { LANGUAGES, MAX_CODE_BYTES, MAX_OUTPUT_BYTES } from "./languages.js";

describe("Language config", () => {
  it("defines all three supported languages", () => {
    expect(LANGUAGES).toHaveProperty("javascript");
    expect(LANGUAGES).toHaveProperty("python");
    expect(LANGUAGES).toHaveProperty("java");
  });

  it("assigns a Judge0 language_id to each language", () => {
    expect(LANGUAGES.javascript.judge0Id).toBe(63);
    expect(LANGUAGES.python.judge0Id).toBe(71);
    expect(LANGUAGES.java.judge0Id).toBe(62);
  });
});

describe("Constants", () => {
  it("MAX_CODE_BYTES is 64 KB", () => {
    expect(MAX_CODE_BYTES).toBe(65_536);
  });

  it("MAX_OUTPUT_BYTES is 50 KB", () => {
    expect(MAX_OUTPUT_BYTES).toBe(51_200);
  });
});
