import { describe, it, expect } from "vitest";
import { splitMessage } from "../splitMessage";

describe("splitMessage", () => {
  it("returns single-element array for short message", () => {
    const result = splitMessage("Hello, world!");
    expect(result).toEqual(["Hello, world!"]);
  });

  it("returns single-element array for message exactly at limit", () => {
    const text = "a".repeat(4096);
    const result = splitMessage(text);
    expect(result).toEqual([text]);
    expect(result).toHaveLength(1);
  });

  it("returns single-element array for empty string", () => {
    const result = splitMessage("");
    expect(result).toEqual([""]);
    expect(result).toHaveLength(1);
  });

  it("splits long message at newline boundaries", () => {
    // Use a small maxLength for easier testing
    const maxLength = 20;
    const text = "Hello world\nThis is a test\nOf splitting";
    const result = splitMessage(text, maxLength);

    // Every chunk should be <= maxLength
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(maxLength);
    }

    // Joined chunks should reconstruct the original text
    expect(result.join("")).toBe(text);
  });

  it("hard-splits long message with no newlines at maxLength", () => {
    const maxLength = 10;
    const text = "a".repeat(25);
    const result = splitMessage(text, maxLength);

    expect(result).toHaveLength(3);
    expect(result[0]).toBe("a".repeat(10));
    expect(result[1]).toBe("a".repeat(10));
    expect(result[2]).toBe("a".repeat(5));

    // Reconstruct check
    expect(result.join("")).toBe(text);
  });

  it("prefers newline split over hard split", () => {
    const maxLength = 10;
    // "abcde\nfghijklmnop" — newline at index 5, maxLength is 10
    // Should split at the newline (index 5+1=6), not at index 10
    const text = "abcde\nfghijklmnop";
    const result = splitMessage(text, maxLength);

    expect(result[0]).toBe("abcde\n");
    // Remaining "fghijklmnop" is 11 chars, > maxLength, no newline → hard split
    expect(result[1]).toBe("fghijklmno");
    expect(result[2]).toBe("p");
  });

  it("handles message that is just over the limit", () => {
    const maxLength = 10;
    const text = "a".repeat(11);
    const result = splitMessage(text, maxLength);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe("a".repeat(10));
    expect(result[1]).toBe("a");
  });

  it("handles multiple newlines correctly", () => {
    const maxLength = 15;
    const text = "line1\nline2\nline3\nline4\nline5";
    const result = splitMessage(text, maxLength);

    // Every chunk should be <= maxLength
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(maxLength);
    }

    // Reconstruct check
    expect(result.join("")).toBe(text);
  });

  it("uses default maxLength of 4096", () => {
    const text = "a".repeat(4097);
    const result = splitMessage(text);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe("a".repeat(4096));
    expect(result[1]).toBe("a");
  });
});
