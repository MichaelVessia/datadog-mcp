import { describe, expect, test } from "bun:test";
import { truncateResponse } from "./truncate";

describe("truncateResponse", () => {
  test("returns short strings unchanged", () => {
    expect(truncateResponse("hello")).toBe("hello");
  });

  test("stringifies objects", () => {
    const result = truncateResponse({ a: 1 });
    expect(result).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  test("stringifies arrays", () => {
    const result = truncateResponse([1, 2, 3]);
    expect(result).toBe(JSON.stringify([1, 2, 3], null, 2));
  });

  test("returns null/undefined as strings", () => {
    expect(truncateResponse(null)).toBe("null");
    expect(truncateResponse(undefined)).toBe("undefined");
  });

  test("does not truncate at exactly the limit", () => {
    const text = "a".repeat(24_000);
    const result = truncateResponse(text);
    expect(result).toBe(text);
    expect(result).not.toContain("TRUNCATED");
  });

  test("truncates content exceeding 24k chars", () => {
    const text = "a".repeat(24_001);
    const result = truncateResponse(text);
    expect(result).toContain("--- TRUNCATED ---");
    expect(result).toContain("limit: 6,000");
  });

  test("truncated output starts with first 24k chars of input", () => {
    const text = "x".repeat(30_000);
    const result = truncateResponse(text);
    expect(result.startsWith("x".repeat(24_000))).toBe(true);
  });

  test("shows estimated token count in truncation message", () => {
    const text = "a".repeat(40_000);
    const result = truncateResponse(text);
    // 40_000 / 4 = 10_000 tokens
    expect(result).toContain("10,000");
  });
});
