import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChatRouterWsClient } from "../wsClient";
import { Bot } from "grammy";

// ---------------------------------------------------------------------------
// Mock WebSocket module
// ---------------------------------------------------------------------------

let mockWsInstance: any = null;

vi.mock("ws", () => {
  const handlers: Record<string, Function> = {};
  const MockWebSocket = vi.fn().mockImplementation((url: string) => {
    const instance = {
      _url: url,
      on: vi.fn((event: string, handler: Function) => {
        handlers[event] = handler;
      }),
      close: vi.fn(),
      _handlers: handlers,
      _triggerOpen: () => handlers.open?.(),
      _triggerMessage: (data: string) => handlers.message?.(Buffer.from(data)),
      _triggerClose: () => handlers.close?.(),
      _triggerError: (err: Error) => handlers.error?.(err),
    };
    mockWsInstance = instance;
    return instance;
  });
  return { default: MockWebSocket };
});

// ---------------------------------------------------------------------------
// Helpers — factory functions for test data
// ---------------------------------------------------------------------------

function makeEntry(overrides?: Partial<any>) {
  return {
    id: 1,
    direction: "out",
    platform: "telegram",
    platformMessageId: "router-1",
    platformChatId: "chat-100",
    platformChatType: null,
    senderName: "System",
    senderId: "system",
    text: "Hello from the system",
    timestamp: Date.now(),
    platformMeta: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makePush(entryOverrides?: Partial<any>): string {
  return JSON.stringify({ type: "new_message", entry: makeEntry(entryOverrides) });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatRouterWsClient", () => {
  let mockSendMessage: ReturnType<typeof vi.fn>;
  let mockBot: Bot;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockSendMessage = vi.fn().mockResolvedValue({});
    mockBot = { api: { sendMessage: mockSendMessage } } as unknown as Bot;
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockWsInstance = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  // ---------------------------------------------------------------------------
  // 1. URL derivation
  // ---------------------------------------------------------------------------

  describe("URL derivation", () => {
    it("converts http://localhost:3100 to ws://localhost:3100/ws", () => {
      const client = new ChatRouterWsClient("http://localhost:3100", mockBot);
      client.connect();
      expect(mockWsInstance._url).toBe("ws://localhost:3100/ws");
    });

    it("converts https://example.com to wss://example.com/ws", () => {
      const client = new ChatRouterWsClient("https://example.com", mockBot);
      client.connect();
      expect(mockWsInstance._url).toBe("wss://example.com/ws");
    });

    it("strips trailing slash: http://localhost:3100/ to ws://localhost:3100/ws", () => {
      const client = new ChatRouterWsClient("http://localhost:3100/", mockBot);
      client.connect();
      expect(mockWsInstance._url).toBe("ws://localhost:3100/ws");
    });

    it("strips multiple trailing slashes", () => {
      const client = new ChatRouterWsClient("http://localhost:3100///", mockBot);
      client.connect();
      expect(mockWsInstance._url).toBe("ws://localhost:3100/ws");
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Message filtering
  // ---------------------------------------------------------------------------

  describe("Message filtering", () => {
    it("delivers when direction=out, platform=telegram, text is non-null", () => {
      const client = new ChatRouterWsClient("http://localhost:3100", mockBot);
      client.connect();

      mockWsInstance._triggerMessage(makePush());

      expect(mockSendMessage).toHaveBeenCalledWith("chat-100", "Hello from the system");
    });

    it("skips when direction=in (no sendMessage call)", () => {
      const client = new ChatRouterWsClient("http://localhost:3100", mockBot);
      client.connect();

      mockWsInstance._triggerMessage(makePush({ direction: "in" }));

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it("skips when platform=discord (no sendMessage call)", () => {
      const client = new ChatRouterWsClient("http://localhost:3100", mockBot);
      client.connect();

      mockWsInstance._triggerMessage(makePush({ platform: "discord" }));

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it("skips when text is null (no sendMessage call)", () => {
      const client = new ChatRouterWsClient("http://localhost:3100", mockBot);
      client.connect();

      mockWsInstance._triggerMessage(makePush({ text: null }));

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it("skips when text is empty string (no sendMessage call)", () => {
      const client = new ChatRouterWsClient("http://localhost:3100", mockBot);
      client.connect();

      mockWsInstance._triggerMessage(makePush({ text: "" }));

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it("skips when type is not new_message (no sendMessage call)", () => {
      const client = new ChatRouterWsClient("http://localhost:3100", mockBot);
      client.connect();

      const payload = JSON.stringify({ type: "heartbeat", entry: makeEntry() });
      mockWsInstance._triggerMessage(payload);

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it("handles malformed JSON gracefully (no throw)", () => {
      const client = new ChatRouterWsClient("http://localhost:3100", mockBot);
      client.connect();

      expect(() => {
        mockWsInstance._triggerMessage("{not valid json");
      }).not.toThrow();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("malformed JSON"),
      );
      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Message delivery
  // ---------------------------------------------------------------------------

  describe("Message delivery", () => {
    it("calls bot.api.sendMessage with correct platformChatId and text", async () => {
      const client = new ChatRouterWsClient("http://localhost:3100", mockBot);
      client.connect();

      mockWsInstance._triggerMessage(
        makePush({ platformChatId: "chat-42", text: "Test message" }),
      );

      // Wait for async delivery
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockSendMessage).toHaveBeenCalledWith("chat-42", "Test message");
    });

    it("splits long messages (>4096 chars) and sends multiple chunks", async () => {
      const client = new ChatRouterWsClient("http://localhost:3100", mockBot);
      client.connect();

      const longText = "A".repeat(5000);
      mockWsInstance._triggerMessage(makePush({ text: longText }));

      // Wait for async delivery
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should split into at least 2 chunks
      expect(mockSendMessage.mock.calls.length).toBeGreaterThan(1);

      // Verify total length matches
      const totalSent = mockSendMessage.mock.calls
        .map((call) => call[1].length)
        .reduce((sum, len) => sum + len, 0);
      expect(totalSent).toBe(5000);

      // Verify each chunk is <= 4096
      mockSendMessage.mock.calls.forEach((call) => {
        expect(call[1].length).toBeLessThanOrEqual(4096);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Error handling
  // ---------------------------------------------------------------------------

  describe("Error handling", () => {
    it("logs warning but doesn't throw when bot.api.sendMessage rejects", async () => {
      mockSendMessage.mockRejectedValue(new Error("Network error"));

      const client = new ChatRouterWsClient("http://localhost:3100", mockBot);
      client.connect();

      expect(() => {
        mockWsInstance._triggerMessage(makePush());
      }).not.toThrow();

      // Wait for async delivery
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to deliver"),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Network error"),
      );
    });

    it("logs warning on WebSocket error event", () => {
      const client = new ChatRouterWsClient("http://localhost:3100", mockBot);
      client.connect();

      mockWsInstance._triggerError(new Error("Connection failed"));

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("WebSocket error"),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Connection failed"),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Connection lifecycle
  // ---------------------------------------------------------------------------

  describe("Connection lifecycle", () => {
    it("logs on successful connection", () => {
      const client = new ChatRouterWsClient("http://localhost:3100", mockBot);
      client.connect();

      mockWsInstance._triggerOpen();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("WebSocket connected"),
      );
    });

    it("attempts reconnect on unintentional close", () => {
      vi.useFakeTimers();

      const client = new ChatRouterWsClient("http://localhost:3100", mockBot);
      client.connect();

      const firstInstance = mockWsInstance;
      mockWsInstance._triggerClose();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("reconnecting in 3s"),
      );

      // Fast-forward 3 seconds
      vi.advanceTimersByTime(3000);

      // Should create new WebSocket instance
      expect(mockWsInstance).not.toBe(firstInstance);

      vi.useRealTimers();
    });

    it("does not reconnect on intentional disconnect", () => {
      vi.useFakeTimers();

      const client = new ChatRouterWsClient("http://localhost:3100", mockBot);
      client.connect();

      const firstInstance = mockWsInstance;
      client.disconnect();

      // Fast-forward past reconnect delay
      vi.advanceTimersByTime(5000);

      // Should not create new instance
      expect(mockWsInstance).toBe(firstInstance);
      expect(firstInstance.close).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
