import { describe, it, expect } from "vitest";
import { mapTelegramToInbound } from "../chatRouterClient";
import type { Context } from "grammy";

// ---------------------------------------------------------------------------
// Helper — minimal mock of grammY Context with message data
// ---------------------------------------------------------------------------

function mockContext(overrides: Record<string, unknown> = {}): Context {
  const defaults = {
    message_id: 42,
    chat: { id: -100123456, type: "group", title: "Test Group" },
    from: {
      id: 999,
      is_bot: false,
      first_name: "Alice",
      last_name: "Smith",
      username: "alicesmith",
    },
    date: 1700000000, // seconds
    text: "Hello world",
  };

  const msg = { ...defaults, ...overrides };

  return { message: msg } as unknown as Context;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mapTelegramToInbound", () => {
  it("sets platform to 'telegram'", () => {
    const result = mapTelegramToInbound(mockContext());
    expect(result.platform).toBe("telegram");
  });

  it("converts platformMessageId to string (not number)", () => {
    const result = mapTelegramToInbound(mockContext());
    expect(result.platformMessageId).toBe("42");
    expect(typeof result.platformMessageId).toBe("string");
  });

  it("converts platformChatId to string (not number)", () => {
    const result = mapTelegramToInbound(mockContext());
    expect(result.platformChatId).toBe("-100123456");
    expect(typeof result.platformChatId).toBe("string");
  });

  it("converts timestamp from seconds to milliseconds", () => {
    const result = mapTelegramToInbound(mockContext());
    expect(result.timestamp).toBe(1700000000000);
  });

  it("concatenates first_name and last_name into senderName", () => {
    const result = mapTelegramToInbound(mockContext());
    expect(result.senderName).toBe("Alice Smith");
  });

  it("handles missing last_name gracefully", () => {
    const result = mapTelegramToInbound(
      mockContext({
        from: {
          id: 999,
          is_bot: false,
          first_name: "Alice",
          username: "alice",
        },
      }),
    );
    expect(result.senderName).toBe("Alice");
  });

  it("sets platformChatType from chat.type", () => {
    const result = mapTelegramToInbound(mockContext());
    expect(result.platformChatType).toBe("group");
  });

  it("includes expected platformMeta fields", () => {
    const result = mapTelegramToInbound(mockContext());
    expect(result.platformMeta).toBeDefined();
    expect(result.platformMeta!.chatTitle).toBe("Test Group");
    expect(result.platformMeta!.fromUsername).toBe("alicesmith");
    expect(result.platformMeta!.fromIsBot).toBe(false);
  });

  it("sets senderId as string", () => {
    const result = mapTelegramToInbound(mockContext());
    expect(result.senderId).toBe("999");
    expect(typeof result.senderId).toBe("string");
  });

  it("preserves message text", () => {
    const result = mapTelegramToInbound(mockContext());
    expect(result.text).toBe("Hello world");
  });
});
