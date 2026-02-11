import type {
  Platform,
  InboundMessage,
  TimelineEntry,
  Conversation,
  IChatRouterService,
} from "./types";
import type { TimelineEntryInput } from "./db/store";
import { ChatRouterStore } from "./db/store";

// ---------------------------------------------------------------------------
// ChatRouterService — implements all business logic
// ---------------------------------------------------------------------------

export class ChatRouterService implements IChatRouterService {
  private store: ChatRouterStore;
  private syntheticIdCounter = 0;

  constructor(store: ChatRouterStore) {
    this.store = store;
  }

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------

  ingestMessage(msg: InboundMessage): TimelineEntry {
    this.validateInbound(msg);

    const entryData: TimelineEntryInput = {
      direction: "in",
      platform: msg.platform,
      platformMessageId: msg.platformMessageId,
      platformChatId: msg.platformChatId,
      platformChatType: msg.platformChatType ?? null,
      senderName: msg.senderName,
      senderId: msg.senderId,
      text: msg.text ?? null,
      timestamp: msg.timestamp,
      platformMeta: msg.platformMeta
        ? JSON.stringify(msg.platformMeta)
        : null,
    };

    return this.store.ingestTransaction(entryData, msg.senderName);
  }

  recordResponse(params: {
    platform: Platform;
    platformChatId: string;
    text: string;
    inReplyTo?: number;
  }): TimelineEntry {
    if (!params.platform) {
      throw new Error("recordResponse: platform is required");
    }
    if (!params.platformChatId) {
      throw new Error("recordResponse: platformChatId is required");
    }
    if (!params.text) {
      throw new Error("recordResponse: text is required");
    }

    this.syntheticIdCounter++;
    const syntheticMessageId = `router-${this.syntheticIdCounter}`;

    const entryData: TimelineEntryInput = {
      direction: "out",
      platform: params.platform,
      platformMessageId: syntheticMessageId,
      platformChatId: params.platformChatId,
      platformChatType: null,
      senderName: "System",
      senderId: "system",
      text: params.text,
      timestamp: Date.now(),
      platformMeta: params.inReplyTo !== undefined
        ? JSON.stringify({ inReplyTo: params.inReplyTo })
        : null,
    };

    return this.store.ingestTransaction(entryData, "System");
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  getTimeline(params: {
    platform: Platform;
    platformChatId: string;
    before?: number;
    limit?: number;
  }): TimelineEntry[] {
    return this.store.getTimeline(
      params.platform,
      params.platformChatId,
      params.before,
      params.limit,
    );
  }

  getUnifiedTimeline(params: {
    before?: number;
    limit?: number;
  }): TimelineEntry[] {
    return this.store.getUnifiedTimeline(params.before, params.limit);
  }

  listConversations(params?: {
    platform?: Platform;
    limit?: number;
  }): Conversation[] {
    return this.store.listConversations(params?.platform, params?.limit);
  }

  getConversation(
    platform: Platform,
    platformChatId: string,
  ): Conversation | null {
    return this.store.getConversation(platform, platformChatId);
  }

  healthCheck(): {
    ok: boolean;
    messageCount: number;
    conversationCount: number;
  } {
    return { ok: true, ...this.store.getStats() };
  }

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

  private validateInbound(msg: InboundMessage): void {
    if (!msg.platform) {
      throw new Error("ingestMessage: platform is required");
    }
    if (!msg.platformMessageId) {
      throw new Error("ingestMessage: platformMessageId is required");
    }
    if (!msg.platformChatId) {
      throw new Error("ingestMessage: platformChatId is required");
    }
    if (!msg.senderName) {
      throw new Error("ingestMessage: senderName is required");
    }
    if (!msg.senderId) {
      throw new Error("ingestMessage: senderId is required");
    }
    if (msg.timestamp === undefined || msg.timestamp === null) {
      throw new Error("ingestMessage: timestamp is required");
    }
  }
}
