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

describe("Chat Router REST API", () => {
  let app: Express;
  let service: ChatRouterService;

  beforeEach(() => {
    const store = new ChatRouterStore(":memory:");
    store.init();
    service = new ChatRouterService(store);
    app = createServer(service);
  });

  // ----- POST /api/messages -----

  describe("POST /api/messages", () => {
    it("valid message returns 201 with id and direction='in'", async () => {
      const res = await request(app)
        .post("/api/messages")
        .send(validMessage())
        .expect(201);

      expect(res.body.id).toBe(1);
      expect(res.body.direction).toBe("in");
      expect(res.body.platform).toBe("telegram");
      expect(res.body.text).toBe("Hello world");
      expect(res.body.createdAt).toBeTruthy();
    });

    it("missing fields returns 400", async () => {
      const res = await request(app)
        .post("/api/messages")
        .send({ platform: "telegram" }) // missing required fields
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  // ----- POST /api/responses -----

  describe("POST /api/responses", () => {
    it("valid response returns 201 with direction='out'", async () => {
      // First ingest a message so conversation exists
      await request(app).post("/api/messages").send(validMessage());

      const res = await request(app)
        .post("/api/responses")
        .send({
          platform: "telegram",
          platformChatId: "chat-100",
          text: "Hi Alice!",
          inReplyTo: 1,
        })
        .expect(201);

      expect(res.body.id).toBe(2);
      expect(res.body.direction).toBe("out");
      expect(res.body.text).toBe("Hi Alice!");
    });

    it("missing text returns 400", async () => {
      const res = await request(app)
        .post("/api/responses")
        .send({
          platform: "telegram",
          platformChatId: "chat-100",
        })
        .expect(400);

      expect(res.body.error).toBeTruthy();
    });
  });

  // ----- GET /api/timeline/:platform/:chatId -----

  describe("GET /api/timeline/:platform/:chatId", () => {
    it("returns correct entries for a conversation", async () => {
      await request(app).post("/api/messages").send(validMessage());
      await request(app)
        .post("/api/messages")
        .send(validMessage({ platformMessageId: "msg-2", text: "Second" }));

      const res = await request(app)
        .get("/api/timeline/telegram/chat-100")
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].id).toBe(2); // most recent first
      expect(res.body[1].id).toBe(1);
    });

    it("supports before and limit query params", async () => {
      // Ingest 5 messages
      for (let i = 1; i <= 5; i++) {
        await request(app)
          .post("/api/messages")
          .send(validMessage({ platformMessageId: `msg-${i}` }));
      }

      const res = await request(app)
        .get("/api/timeline/telegram/chat-100?before=4&limit=2")
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0].id).toBe(3);
      expect(res.body[1].id).toBe(2);
    });
  });

  // ----- GET /api/timeline -----

  describe("GET /api/timeline", () => {
    it("unified timeline across platforms", async () => {
      await request(app).post("/api/messages").send(validMessage());
      await request(app)
        .post("/api/messages")
        .send(
          validMessage({
            platform: "discord",
            platformChatId: "dc-1",
            platformMessageId: "dc-msg-1",
          }),
        );

      const res = await request(app).get("/api/timeline").expect(200);

      expect(res.body).toHaveLength(2);
      const platforms = res.body.map((e: any) => e.platform).sort();
      expect(platforms).toEqual(["discord", "telegram"]);
    });
  });

  // ----- GET /api/conversations -----

  describe("GET /api/conversations", () => {
    it("lists conversations", async () => {
      await request(app).post("/api/messages").send(validMessage());
      await request(app)
        .post("/api/messages")
        .send(
          validMessage({
            platformChatId: "chat-200",
            platformMessageId: "msg-2",
          }),
        );

      const res = await request(app).get("/api/conversations").expect(200);

      expect(res.body).toHaveLength(2);
    });

    it("filters by platform query param", async () => {
      await request(app).post("/api/messages").send(validMessage());
      await request(app)
        .post("/api/messages")
        .send(
          validMessage({
            platform: "discord",
            platformChatId: "dc-1",
            platformMessageId: "dc-msg-1",
          }),
        );

      const res = await request(app)
        .get("/api/conversations?platform=telegram")
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].platform).toBe("telegram");
    });
  });

  // ----- GET /api/conversations/:platform/:chatId -----

  describe("GET /api/conversations/:platform/:chatId", () => {
    it("returns single conversation", async () => {
      await request(app).post("/api/messages").send(validMessage());

      const res = await request(app)
        .get("/api/conversations/telegram/chat-100")
        .expect(200);

      expect(res.body.platform).toBe("telegram");
      expect(res.body.platformChatId).toBe("chat-100");
      expect(res.body.messageCount).toBe(1);
    });

    it("returns 404 for unknown conversation", async () => {
      const res = await request(app)
        .get("/api/conversations/telegram/nonexistent")
        .expect(404);

      expect(res.body.error).toBeTruthy();
    });
  });

  // ----- GET /api/health -----

  describe("GET /api/health", () => {
    it("returns ok with counts", async () => {
      const res = await request(app).get("/api/health").expect(200);

      expect(res.body.ok).toBe(true);
      expect(res.body.messageCount).toBe(0);
      expect(res.body.conversationCount).toBe(0);
    });
  });
});
