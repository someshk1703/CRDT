import { describe, it, expect, vi } from "vitest";
import { LANGUAGES, MAX_CODE_BYTES, MAX_OUTPUT_BYTES } from "./languages.js";

describe("Language config", () => {
  it("defines all three supported languages", () => {
    expect(LANGUAGES).toHaveProperty("javascript");
    expect(LANGUAGES).toHaveProperty("python");
    expect(LANGUAGES).toHaveProperty("java");
  });

  it("marks java as twoStep", () => {
    expect(LANGUAGES.java.twoStep).toBe(true);
  });

  it("does not mark javascript as twoStep", () => {
    expect(LANGUAGES.javascript.twoStep).toBeUndefined();
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
