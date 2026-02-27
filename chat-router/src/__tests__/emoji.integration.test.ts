import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import { ChatRouterStore } from "../db/store";
import { ChatRouterService } from "../service";
import { createServer } from "../api/server";
import type { Express } from "express";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validMessage(overrides: Record<string, unknown> = {}) {
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

describe("Emoji Encoding Integration", () => {
  let app: Express;
  let service: ChatRouterService;

  beforeEach(() => {
    const store = new ChatRouterStore(":memory:");
    store.init();
    service = new ChatRouterService(store);
    app = createServer(service);
  });

  // ----- Emoji preservation in inbound messages -----

  it("preserves emojis in inbound messages (HTTP → SQLite → HTTP)", async () => {
    const emojiText = "Hello 😀 World 🌍 Test 🚀";
    const res = await request(app)
      .post("/api/messages")
      .send(validMessage({ text: emojiText }))
      .expect(201);

    expect(res.body.text).toBe(emojiText);
    expect(res.body.text).not.toContain("\uFFFD");
  });

  // ----- Emoji preservation in outbound responses -----

  it("preserves emojis in outbound responses", async () => {
    // First ingest a message to create conversation
    await request(app).post("/api/messages").send(validMessage());

    const emojiText = "Thanks! Here's your result: 🎉 Success ✅";
    const res = await request(app)
      .post("/api/responses")
      .send({
        platform: "telegram",
        platformChatId: "chat-100",
        text: emojiText,
        inReplyTo: 1,
      })
      .expect(201);

    expect(res.body.text).toBe(emojiText);
    expect(res.body.text).not.toContain("\uFFFD");
  });

  // ----- Emoji-only messages -----

  it("handles emoji-only messages", async () => {
    const emojiOnly = "😀🎉👍🌍🚀";
    const res = await request(app)
      .post("/api/messages")
      .send(validMessage({ text: emojiOnly }))
      .expect(201);

    expect(res.body.text).toBe(emojiOnly);
    expect(res.body.text).not.toContain("\uFFFD");
  });

  // ----- Emoji preservation in timeline retrieval -----

  it("preserves emojis when retrieving timeline", async () => {
    const emojiText = "Search results: 🏠 4bd/2ba in Fresno 💰 $350k";
    await request(app)
      .post("/api/messages")
      .send(validMessage({ text: emojiText }))
      .expect(201);

    const res = await request(app)
      .get("/api/timeline/telegram/chat-100")
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0].text).toBe(emojiText);
    expect(res.body[0].text).not.toContain("\uFFFD");
  });
});
