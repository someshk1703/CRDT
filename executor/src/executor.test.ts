import { describe, it, expect } from "vitest";
import { LANGUAGES, MAX_CODE_BYTES, MAX_OUTPUT_BYTES } from "./languages.js";

describe("Language config", () => {
  it("defines all three supported languages", () => {
    expect(LANGUAGES).toHaveProperty("javascript");
    expect(LANGUAGES).toHaveProperty("python");
    expect(LANGUAGES).toHaveProperty("java");
  });

  it("assigns a Docker image to each language", () => {
    expect(LANGUAGES.javascript.image).toBe("node:20-alpine");
    expect(LANGUAGES.python.image).toBe("python:3.12-slim");
    expect(LANGUAGES.java.image).toBe("openjdk:17-alpine");
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
