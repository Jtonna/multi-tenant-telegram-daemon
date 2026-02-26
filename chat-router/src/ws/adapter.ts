// ---------------------------------------------------------------------------
// WebSocket adapter — attaches to the HTTP server and bridges the service
// ---------------------------------------------------------------------------

import type { Server as HttpServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import type { ChatRouterService } from "../service";
import type { Platform, TimelineEntry } from "../types";
import type { WsRequest, WsResponse, WsPush, WsError } from "./protocol";

// ---------------------------------------------------------------------------
// attachWebSocket
// ---------------------------------------------------------------------------

export function attachWebSocket(
  server: HttpServer,
  service: ChatRouterService,
): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  // -----------------------------------------------------------------------
  // Connection handling
  // -----------------------------------------------------------------------

  wss.on("connection", (ws: WebSocket) => {
    console.log("[ws] client connected");

    ws.on("message", (raw: Buffer | string) => {
      let req: WsRequest;
      try {
        req = JSON.parse(typeof raw === "string" ? raw : raw.toString("utf-8"));
      } catch {
        sendError(ws, "malformed JSON");
        return;
      }

      try {
        handleRequest(ws, req, service);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        sendError(ws, msg);
      }
    });

    ws.on("close", () => {
      console.log("[ws] client disconnected");
    });

    ws.on("error", (err: Error) => {
      console.error("[ws] socket error:", err.message);
    });
  });

  // -----------------------------------------------------------------------
  // Broadcast new messages to all connected clients
  // -----------------------------------------------------------------------

  service.on("message:new", (entry: TimelineEntry) => {
    const push: WsPush = { type: "new_message", entry };
    const payload = JSON.stringify(push);

    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  console.log("[ws] WebSocket adapter attached on /ws");
}

// ---------------------------------------------------------------------------
// Request dispatcher
// ---------------------------------------------------------------------------

function handleRequest(
  ws: WebSocket,
  req: WsRequest,
  service: ChatRouterService,
): void {
  switch (req.type) {
    case "health": {
      sendResponse(ws, "health", service.healthCheck());
      break;
    }
    case "conversations": {
      const data = service.listConversations({
        platform: req.platform as Platform | undefined,
        limit: req.limit,
      });
      sendResponse(ws, "conversations", data);
      break;
    }
    case "timeline": {
      const data = service.getTimeline({
        platform: req.platform as Platform,
        platformChatId: req.platformChatId,
        after: req.after,
        before: req.before,
        limit: req.limit,
      });
      sendResponse(ws, "timeline", data);
      break;
    }
    case "unified_timeline": {
      const data = service.getUnifiedTimeline({
        after: req.after,
        before: req.before,
        limit: req.limit,
      });
      sendResponse(ws, "unified_timeline", data);
      break;
    }
    default: {
      sendError(ws, `unknown request type: ${(req as { type: string }).type}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sendResponse(ws: WebSocket, requestType: string, data: unknown): void {
  const msg: WsResponse = { type: "response", requestType, data };
  ws.send(JSON.stringify(msg));
}

function sendError(ws: WebSocket, message: string): void {
  const msg: WsError = { type: "error", message };
  ws.send(JSON.stringify(msg));
}
