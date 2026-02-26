import { describe, it, expect, beforeEach, afterEach } from "vitest";
import http from "http";
import { WebSocket } from "ws";
import { ChatRouterStore } from "../db/store";
import { ChatRouterService } from "../service";
import { createServer } from "../api/server";
import { attachWebSocket } from "../ws/adapter";
import type { InboundMessage } from "../types";

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

/** Send a JSON request over WebSocket and wait for the next response. */
function wsRequest(ws: WebSocket, payload: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("ws response timeout")), 3000);
    ws.once("message", (raw) => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(raw.toString()));
      } catch (err) {
        reject(err);
      }
    });
    ws.send(JSON.stringify(payload));
  });
}

/** Wait for the next WebSocket message (without sending). */
function wsWaitMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("ws push timeout")), 3000);
    ws.once("message", (raw) => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(raw.toString()));
      } catch (err) {
        reject(err);
      }
    });
  });
}

/** Connect a WebSocket client and wait for it to open. */
function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WebSocket adapter", () => {
  let store: ChatRouterStore;
  let service: ChatRouterService;
  let server: http.Server;
  let port: number;
  let clients: WebSocket[];

  beforeEach(async () => {
    store = new ChatRouterStore(":memory:");
    store.init();
    service = new ChatRouterService(store);

    const app = createServer(service);
    server = http.createServer(app);
    attachWebSocket(server, service);

    // Listen on port 0 to get a random available port
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const addr = server.address();
    port = typeof addr === "object" && addr ? addr.port : 0;
    clients = [];
  });

  afterEach(async () => {
    // Close all WebSocket clients
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }

    // Close the HTTP server
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  /** Helper to connect and track the client for cleanup. */
  async function connect(): Promise<WebSocket> {
    const ws = await connectWs(port);
    clients.push(ws);
    return ws;
  }

  // ----- Connection -----

  it("accepts a WebSocket connection on /ws", async () => {
    const ws = await connect();
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  // ----- Health request -----

  it("responds to a health request", async () => {
    const ws = await connect();
    const resp = await wsRequest(ws, { type: "health" });

    expect(resp.type).toBe("response");
    expect(resp.requestType).toBe("health");
    expect(resp.data.ok).toBe(true);
    expect(resp.data.messageCount).toBe(0);
    expect(resp.data.conversationCount).toBe(0);
  });

  // ----- Conversations request -----

  it("responds to a conversations request", async () => {
    // Seed a conversation via the service
    service.ingestMessage(makeInbound());

    const ws = await connect();
    const resp = await wsRequest(ws, { type: "conversations" });

    expect(resp.type).toBe("response");
    expect(resp.requestType).toBe("conversations");
    expect(resp.data).toHaveLength(1);
    expect(resp.data[0].platform).toBe("telegram");
    expect(resp.data[0].platformChatId).toBe("chat-100");
  });

  // ----- Timeline request -----

  it("responds to a timeline request", async () => {
    service.ingestMessage(makeInbound());

    const ws = await connect();
    const resp = await wsRequest(ws, {
      type: "timeline",
      platform: "telegram",
      platformChatId: "chat-100",
    });

    expect(resp.type).toBe("response");
    expect(resp.requestType).toBe("timeline");
    expect(resp.data).toHaveLength(1);
    expect(resp.data[0].text).toBe("Hello world");
  });

  // ----- Unified timeline request -----

  it("responds to a unified_timeline request", async () => {
    service.ingestMessage(makeInbound({ platformMessageId: "m1" }));
    service.ingestMessage(
      makeInbound({
        platform: "discord",
        platformChatId: "dc-1",
        platformMessageId: "m2",
      }),
    );

    const ws = await connect();
    const resp = await wsRequest(ws, { type: "unified_timeline" });

    expect(resp.type).toBe("response");
    expect(resp.requestType).toBe("unified_timeline");
    expect(resp.data).toHaveLength(2);
  });

  // ----- Malformed JSON -----

  it("returns an error for malformed JSON", async () => {
    const ws = await connect();

    const resp = await new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 3000);
      ws.once("message", (raw) => {
        clearTimeout(timeout);
        resolve(JSON.parse(raw.toString()));
      });
      ws.send("not valid json {{{");
    });

    expect(resp.type).toBe("error");
    expect(resp.message).toBe("malformed JSON");
  });

  // ----- Unknown request type -----

  it("returns an error for unknown request type", async () => {
    const ws = await connect();
    const resp = await wsRequest(ws, { type: "foobar" });

    expect(resp.type).toBe("error");
    expect(resp.message).toContain("unknown request type");
    expect(resp.message).toContain("foobar");
  });

  // ----- Real-time push on ingest -----

  it("pushes new_message to connected clients when a message is ingested", async () => {
    const ws = await connect();

    // Set up listener before ingesting
    const pushPromise = wsWaitMessage(ws);

    // Ingest a message via the service (not via WS)
    service.ingestMessage(makeInbound({ text: "pushed!" }));

    const push = await pushPromise;
    expect(push.type).toBe("new_message");
    expect(push.entry).toBeDefined();
    expect(push.entry.text).toBe("pushed!");
    expect(push.entry.direction).toBe("in");
  });

  // ----- Real-time push on response -----

  it("pushes new_message to connected clients when a response is recorded", async () => {
    // Seed a conversation so recordResponse works
    service.ingestMessage(makeInbound());

    const ws = await connect();
    const pushPromise = wsWaitMessage(ws);

    service.recordResponse({
      platform: "telegram",
      platformChatId: "chat-100",
      text: "System reply",
      inReplyTo: 1,
    });

    const push = await pushPromise;
    expect(push.type).toBe("new_message");
    expect(push.entry.direction).toBe("out");
    expect(push.entry.text).toBe("System reply");
  });
});
