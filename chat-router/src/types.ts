// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export type Platform = "telegram" | "discord" | "web";

// ---------------------------------------------------------------------------
// InboundMessage — normalized input from any platform plugin
// ---------------------------------------------------------------------------

export interface InboundMessage {
  platform: Platform;
  /** Platform-specific message ID (string to accommodate all platforms). */
  platformMessageId: string;
  /** Platform-specific chat/conversation ID. */
  platformChatId: string;
  /** e.g. "private", "group" */
  platformChatType?: string;
  /** Display name of the sender. */
  senderName: string;
  /** Platform-specific sender ID. */
  senderId: string;
  /** Message text (undefined for non-text messages). */
  text?: string;
  /** Unix milliseconds when sent on the platform. */
  timestamp: number;
  /** Bag for platform-specific data, stored as JSON. */
  platformMeta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// TimelineEntry — persisted message (what the service returns)
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  /** Auto-increment primary key. */
  id: number;
  /** "in" = from user, "out" = from AI/system. */
  direction: "in" | "out";
  platform: Platform;
  platformMessageId: string;
  platformChatId: string;
  platformChatType: string | null;
  senderName: string;
  senderId: string;
  text: string | null;
  /** Unix milliseconds when sent on the platform. */
  timestamp: number;
  /** Serialized JSON, nullable. */
  platformMeta: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

// ---------------------------------------------------------------------------
// OutboundMessage — response to deliver to a platform
// ---------------------------------------------------------------------------

export interface OutboundMessage {
  /** Timeline entry ID. */
  id: number;
  platform: Platform;
  platformChatId: string;
  text: string;
  /** Timeline entry ID this replies to. */
  inReplyTo?: number;
}

// ---------------------------------------------------------------------------
// Conversation — tracks unique (platform, platformChatId) pairs
// ---------------------------------------------------------------------------

export interface Conversation {
  id: number;
  platform: Platform;
  platformChatId: string;
  platformChatType: string | null;
  /** Display label (sender name or chat title). */
  label: string;
  /** ISO 8601. */
  firstSeenAt: string;
  /** ISO 8601. */
  lastMessageAt: string;
  messageCount: number;
}

// ---------------------------------------------------------------------------
// IChatRouterService
// ---------------------------------------------------------------------------

export interface IChatRouterService {
  ingestMessage(msg: InboundMessage): TimelineEntry;

  recordResponse(params: {
    platform: Platform;
    platformChatId: string;
    text: string;
    inReplyTo?: number;
  }): TimelineEntry;

  getTimeline(params: {
    platform: Platform;
    platformChatId: string;
    after?: number;
    before?: number;
    limit?: number;
  }): TimelineEntry[];

  getUnifiedTimeline(params: {
    after?: number;
    before?: number;
    limit?: number;
  }): TimelineEntry[];

  listConversations(params?: {
    platform?: Platform;
    limit?: number;
  }): Conversation[];

  getConversation(
    platform: Platform,
    platformChatId: string,
  ): Conversation | null;

  healthCheck(): {
    ok: boolean;
    messageCount: number;
    conversationCount: number;
  };
}
