import { describe, it, expect, beforeEach, vi } from "vitest";
import { ChatRouterService } from "../service";
import { ChatRouterStore } from "../db/store";
import type { InboundMessage, TimelineEntry } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInbound(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    platform: "telegram",
    platformMessageId: "msg-1",
    platformChatId: "chat-100",
    platformChatType: "private",
    senderName: "Alice",
    senderId: "user-1",
    text: "Hello world",
    timestamp: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatRouterService", () => {
  let store: ChatRouterStore;
  let service: ChatRouterService;

  beforeEach(() => {
    store = new ChatRouterStore(":memory:");
    store.init();
    service = new ChatRouterService(store);
  });

  // ----- ingestMessage with valid data -----

  it("ingestMessage returns TimelineEntry with id and direction='in'", () => {
    const entry = service.ingestMessage(makeInbound());

    expect(entry.id).toBe(1);
    expect(entry.direction).toBe("in");
    expect(entry.platform).toBe("telegram");
    expect(entry.platformMessageId).toBe("msg-1");
    expect(entry.platformChatId).toBe("chat-100");
    expect(entry.senderName).toBe("Alice");
    expect(entry.senderId).toBe("user-1");
    expect(entry.text).toBe("Hello world");
    expect(entry.createdAt).toBeTruthy();
  });

  // ----- ingestMessage with missing required fields -----

  it("throws when platform is missing", () => {
    expect(() =>
      service.ingestMessage(makeInbound({ platform: "" as any })),
    ).toThrow("platform is required");
  });

  it("throws when platformMessageId is missing", () => {
    expect(() =>
      service.ingestMessage(makeInbound({ platformMessageId: "" })),
    ).toThrow("platformMessageId is required");
  });

  it("throws when platformChatId is missing", () => {
    expect(() =>
      service.ingestMessage(makeInbound({ platformChatId: "" })),
    ).toThrow("platformChatId is required");
  });

  it("throws when senderName is missing", () => {
    expect(() =>
      service.ingestMessage(makeInbound({ senderName: "" })),
    ).toThrow("senderName is required");
  });

  it("throws when senderId is missing", () => {
    expect(() =>
      service.ingestMessage(makeInbound({ senderId: "" })),
    ).toThrow("senderId is required");
  });

  it("throws when timestamp is missing", () => {
    expect(() =>
      service.ingestMessage(makeInbound({ timestamp: undefined as any })),
    ).toThrow("timestamp is required");
  });

  // ----- recordResponse -----

  it("recordResponse creates outbound entry with direction='out'", () => {
    // First ingest so the conversation exists
    service.ingestMessage(makeInbound());

    const response = service.recordResponse({
      platform: "telegram",
      platformChatId: "chat-100",
      text: "Hi Alice!",
      inReplyTo: 1,
    });

    expect(response.id).toBe(2);
    expect(response.direction).toBe("out");
    expect(response.senderName).toBe("System");
    expect(response.senderId).toBe("system");
    expect(response.text).toBe("Hi Alice!");
    expect(response.platformMessageId).toMatch(/^router-/);
    expect(response.platformMeta).not.toBeNull();

    const meta = JSON.parse(response.platformMeta!);
    expect(meta.inReplyTo).toBe(1);
  });

  // ----- getTimeline -----

  it("getTimeline returns messages for correct conversation only", () => {
    service.ingestMessage(
      makeInbound({ platformChatId: "chat-A", platformMessageId: "m1" }),
    );
    service.ingestMessage(
      makeInbound({ platformChatId: "chat-B", platformMessageId: "m2" }),
    );
    service.ingestMessage(
      makeInbound({ platformChatId: "chat-A", platformMessageId: "m3" }),
    );

    const timelineA = service.getTimeline({
      platform: "telegram",
      platformChatId: "chat-A",
    });
    expect(timelineA).toHaveLength(2);
    expect(timelineA.every((e) => e.platformChatId === "chat-A")).toBe(true);

    const timelineB = service.getTimeline({
      platform: "telegram",
      platformChatId: "chat-B",
    });
    expect(timelineB).toHaveLength(1);
  });

  // ----- listConversations across platforms -----

  it("listConversations shows conversations from multiple platforms", () => {
    service.ingestMessage(
      makeInbound({
        platform: "telegram",
        platformChatId: "tg-1",
        platformMessageId: "m1",
      }),
    );
    service.ingestMessage(
      makeInbound({
        platform: "discord",
        platformChatId: "dc-1",
        platformMessageId: "m2",
      }),
    );
    service.ingestMessage(
      makeInbound({
        platform: "web",
        platformChatId: "web-1",
        platformMessageId: "m3",
      }),
    );

    const convos = service.listConversations();
    expect(convos).toHaveLength(3);

    const platforms = convos.map((c) => c.platform).sort();
    expect(platforms).toEqual(["discord", "telegram", "web"]);
  });

  // ----- healthCheck -----

  it("healthCheck returns correct counts", () => {
    expect(service.healthCheck()).toEqual({
      ok: true,
      messageCount: 0,
      conversationCount: 0,
    });

    service.ingestMessage(makeInbound({ platformMessageId: "m1" }));
    service.ingestMessage(
      makeInbound({
        platform: "discord",
        platformChatId: "dc-1",
        platformMessageId: "m2",
      }),
    );

    const health = service.healthCheck();
    expect(health.ok).toBe(true);
    expect(health.messageCount).toBe(2);
    expect(health.conversationCount).toBe(2);
  });

  // ----- Round-trip test -----

  it("round-trip: ingest -> getTimeline -> all fields preserved", () => {
    const msg = makeInbound({
      platform: "telegram",
      platformMessageId: "roundtrip-1",
      platformChatId: "chat-rt",
      platformChatType: "group",
      senderName: "Bob",
      senderId: "user-bob",
      text: "Round-trip message",
      timestamp: 1700000000000,
      platformMeta: { botCommand: "/start", entities: [1, 2] },
    });

    const ingested = service.ingestMessage(msg);

    const timeline = service.getTimeline({
      platform: "telegram",
      platformChatId: "chat-rt",
    });

    expect(timeline).toHaveLength(1);
    const retrieved = timeline[0];

    expect(retrieved.id).toBe(ingested.id);
    expect(retrieved.direction).toBe("in");
    expect(retrieved.platform).toBe("telegram");
    expect(retrieved.platformMessageId).toBe("roundtrip-1");
    expect(retrieved.platformChatId).toBe("chat-rt");
    expect(retrieved.platformChatType).toBe("group");
    expect(retrieved.senderName).toBe("Bob");
    expect(retrieved.senderId).toBe("user-bob");
    expect(retrieved.text).toBe("Round-trip message");
    expect(retrieved.timestamp).toBe(1700000000000);
    expect(retrieved.createdAt).toBeTruthy();

    // platformMeta round-trips as serialised JSON
    expect(retrieved.platformMeta).not.toBeNull();
    const meta = JSON.parse(retrieved.platformMeta!);
    expect(meta.botCommand).toBe("/start");
    expect(meta.entities).toEqual([1, 2]);
  });

  // ----- EventEmitter: ingestMessage emits message:new -----

  it("ingestMessage emits a 'message:new' event with the TimelineEntry", () => {
    const listener = vi.fn();
    service.on("message:new", listener);

    const entry = service.ingestMessage(makeInbound({ text: "event test" }));

    expect(listener).toHaveBeenCalledTimes(1);
    const emitted: TimelineEntry = listener.mock.calls[0][0];
    expect(emitted.id).toBe(entry.id);
    expect(emitted.direction).toBe("in");
    expect(emitted.text).toBe("event test");
    expect(emitted.platform).toBe("telegram");
  });

  // ----- EventEmitter: recordResponse emits message:new -----

  it("recordResponse emits a 'message:new' event with the TimelineEntry", () => {
    // Ingest first so the conversation exists
    service.ingestMessage(makeInbound());

    const listener = vi.fn();
    service.on("message:new", listener);

    const entry = service.recordResponse({
      platform: "telegram",
      platformChatId: "chat-100",
      text: "response event",
      inReplyTo: 1,
    });

    expect(listener).toHaveBeenCalledTimes(1);
    const emitted: TimelineEntry = listener.mock.calls[0][0];
    expect(emitted.id).toBe(entry.id);
    expect(emitted.direction).toBe("out");
    expect(emitted.text).toBe("response event");
    expect(emitted.senderName).toBe("System");
  });

  // ----- EventEmitter: multiple listeners receive events -----

  it("multiple listeners all receive the message:new event", () => {
    const listener1 = vi.fn();
    const listener2 = vi.fn();
    service.on("message:new", listener1);
    service.on("message:new", listener2);

    service.ingestMessage(makeInbound({ text: "multi-listener" }));

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });
});
