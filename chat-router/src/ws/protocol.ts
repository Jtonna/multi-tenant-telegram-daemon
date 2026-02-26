// ---------------------------------------------------------------------------
// WebSocket JSON protocol types
// ---------------------------------------------------------------------------

import type { TimelineEntry } from "../types";

// ---------------------------------------------------------------------------
// Client -> Server requests
// ---------------------------------------------------------------------------

export type WsRequest =
  | { type: "health" }
  | { type: "conversations"; platform?: string; limit?: number }
  | {
      type: "timeline";
      platform: string;
      platformChatId: string;
      after?: number;
      before?: number;
      limit?: number;
    }
  | {
      type: "unified_timeline";
      after?: number;
      before?: number;
      limit?: number;
    };

// ---------------------------------------------------------------------------
// Server -> Client responses (to a request)
// ---------------------------------------------------------------------------

export interface WsResponse {
  type: "response";
  requestType: string;
  data: unknown;
}

// ---------------------------------------------------------------------------
// Server -> Client push (new message ingested/recorded)
// ---------------------------------------------------------------------------

export interface WsPush {
  type: "new_message";
  entry: TimelineEntry;
}

// ---------------------------------------------------------------------------
// Server -> Client error
// ---------------------------------------------------------------------------

export interface WsError {
  type: "error";
  message: string;
}
