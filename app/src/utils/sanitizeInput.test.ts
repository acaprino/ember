import { describe, it, expect } from "vitest";
import { sanitizeInput } from "./sanitizeInput";

describe("sanitizeInput", () => {
  it("passes through normal text unchanged", () => {
    expect(sanitizeInput("Hello world")).toBe("Hello world");
  });

  it("strips lone high surrogates", () => {
    expect(sanitizeInput("before\uD800after")).toBe("beforeafter");
  });

  it("strips lone low surrogates", () => {
    expect(sanitizeInput("before\uDC00after")).toBe("beforeafter");
  });

  it("preserves valid surrogate pairs (emoji)", () => {
    expect(sanitizeInput("hello 😀 world")).toBe("hello 😀 world");
  });

  it("normalizes smart double quotes", () => {
    expect(sanitizeInput("\u201Chello\u201D")).toBe('"hello"');
  });

  it("normalizes smart single quotes", () => {
    expect(sanitizeInput("\u2018it\u2019s")).toBe("'it's");
  });

  it("normalizes em dash to --", () => {
    expect(sanitizeInput("a\u2014b")).toBe("a--b");
  });

  it("normalizes en dash to -", () => {
    expect(sanitizeInput("a\u2013b")).toBe("a-b");
  });

  it("normalizes ellipsis to ...", () => {
    expect(sanitizeInput("wait\u2026")).toBe("wait...");
  });

  it("strips zero-width characters", () => {
    expect(sanitizeInput("a\u200Bb\u200Cc\u200Dd\uFEFFe")).toBe("abcde");
  });

  it("handles empty string", () => {
    expect(sanitizeInput("")).toBe("");
  });

  it("handles multiple issues in one string", () => {
    expect(sanitizeInput("\u201CHello\u201D\u2014\uD800world\u2026")).toBe('"Hello"--world...');
  });
});
