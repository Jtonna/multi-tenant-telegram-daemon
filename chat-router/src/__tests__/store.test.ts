import { describe, it, expect, beforeEach } from "vitest";
import { ChatRouterStore, TimelineEntryInput } from "../db/store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<TimelineEntryInput> = {}): TimelineEntryInput {
  return {
    direction: "in",
    platform: "telegram",
    platformMessageId: "msg-1",
    platformChatId: "chat-100",
    platformChatType: "private",
    senderName: "Alice",
    senderId: "user-1",
    text: "Hello",
    timestamp: Date.now(),
    platformMeta: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatRouterStore", () => {
  let store: ChatRouterStore;

  beforeEach(() => {
    store = new ChatRouterStore(":memory:");
    store.init();
  });

  // ----- Schema initialization -----

  it("initialises with empty state", () => {
    const stats = store.getStats();
    expect(stats.messageCount).toBe(0);
    expect(stats.conversationCount).toBe(0);
  });

  // ----- Insert and retrieve -----

  it("inserts and retrieves a timeline entry", () => {
    const entry = store.insertTimelineEntry(makeEntry());

    expect(entry.id).toBe(1);
    expect(entry.direction).toBe("in");
    expect(entry.platform).toBe("telegram");
    expect(entry.text).toBe("Hello");
    expect(entry.createdAt).toBeTruthy();

    const timeline = store.getTimeline("telegram", "chat-100");
    expect(timeline).toHaveLength(1);
    expect(timeline[0].id).toBe(1);
  });

  // ----- Conversation auto-creation -----

  it("auto-creates a conversation on first message", () => {
    store.ingestTransaction(makeEntry(), "Alice");

    const convo = store.getConversation("telegram", "chat-100");
    expect(convo).not.toBeNull();
    expect(convo!.platform).toBe("telegram");
    expect(convo!.platformChatId).toBe("chat-100");
    expect(convo!.label).toBe("Alice");
    expect(convo!.messageCount).toBe(1);
    expect(convo!.firstSeenAt).toBeTruthy();
    expect(convo!.lastMessageAt).toBeTruthy();
  });

  // ----- Conversation messageCount increments -----

  it("increments messageCount on subsequent messages", () => {
    store.ingestTransaction(makeEntry({ platformMessageId: "msg-1" }), "Alice");
    store.ingestTransaction(makeEntry({ platformMessageId: "msg-2" }), "Alice");
    store.ingestTransaction(makeEntry({ platformMessageId: "msg-3" }), "Alice");

    const convo = store.getConversation("telegram", "chat-100");
    expect(convo!.messageCount).toBe(3);
  });

  // ----- getTimeline ordering and pagination -----

  it("returns timeline in correct order with pagination (before cursor)", () => {
    // Insert 5 messages
    for (let i = 1; i <= 5; i++) {
      store.insertTimelineEntry(
        makeEntry({ platformMessageId: `msg-${i}`, text: `Message ${i}` }),
      );
    }

    // Default: most recent first
    const all = store.getTimeline("telegram", "chat-100");
    expect(all).toHaveLength(5);
    expect(all[0].id).toBe(5);
    expect(all[4].id).toBe(1);

    // Cursor: entries before id 4
    const page = store.getTimeline("telegram", "chat-100", 4, 2);
    expect(page).toHaveLength(2);
    expect(page[0].id).toBe(3);
    expect(page[1].id).toBe(2);
  });

  // ----- getUnifiedTimeline across platforms -----

  it("returns unified timeline across platforms", () => {
    store.insertTimelineEntry(
      makeEntry({ platform: "telegram", platformChatId: "tg-1", platformMessageId: "m1" }),
    );
    store.insertTimelineEntry(
      makeEntry({ platform: "discord", platformChatId: "dc-1", platformMessageId: "m2" }),
    );
    store.insertTimelineEntry(
      makeEntry({ platform: "web", platformChatId: "web-1", platformMessageId: "m3" }),
    );

    const timeline = store.getUnifiedTimeline();
    expect(timeline).toHaveLength(3);
    // Most recent first
    expect(timeline[0].platform).toBe("web");
    expect(timeline[1].platform).toBe("discord");
    expect(timeline[2].platform).toBe("telegram");
  });

  // ----- listConversations ordered by recency -----

  it("lists conversations ordered by recency", async () => {
    store.ingestTransaction(
      makeEntry({ platform: "telegram", platformChatId: "chat-A", platformMessageId: "m1" }),
      "Alice",
    );

    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));

    store.ingestTransaction(
      makeEntry({ platform: "discord", platformChatId: "chat-B", platformMessageId: "m2" }),
      "Bob",
    );

    await new Promise((r) => setTimeout(r, 10));

    store.ingestTransaction(
      makeEntry({ platform: "web", platformChatId: "chat-C", platformMessageId: "m3" }),
      "Charlie",
    );

    const convos = store.listConversations();
    expect(convos).toHaveLength(3);
    // Most recent first
    expect(convos[0].label).toBe("Charlie");
    expect(convos[1].label).toBe("Bob");
    expect(convos[2].label).toBe("Alice");
  });

  // ----- listConversations with platform filter -----

  it("filters conversations by platform", () => {
    store.ingestTransaction(
      makeEntry({ platform: "telegram", platformChatId: "tg-1", platformMessageId: "m1" }),
      "Alice",
    );
    store.ingestTransaction(
      makeEntry({ platform: "discord", platformChatId: "dc-1", platformMessageId: "m2" }),
      "Bob",
    );

    const telegramOnly = store.listConversations("telegram");
    expect(telegramOnly).toHaveLength(1);
    expect(telegramOnly[0].platform).toBe("telegram");
  });

  // ----- getConversation returns null for unknown -----

  it("returns null for unknown conversation", () => {
    const result = store.getConversation("telegram", "nonexistent");
    expect(result).toBeNull();
  });
});
