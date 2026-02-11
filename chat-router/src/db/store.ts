import * as fs from "fs";
import * as path from "path";
import type {
  Platform,
  TimelineEntry,
  Conversation,
  InboundMessage,
} from "../types";

// ---------------------------------------------------------------------------
// Internal state shape (serialized to / from JSON file)
// ---------------------------------------------------------------------------

interface StoreState {
  timeline: TimelineEntry[];
  conversations: Conversation[];
  nextTimelineId: number;
  nextConversationId: number;
}

// ---------------------------------------------------------------------------
// Data passed to insertTimelineEntry (id and createdAt are assigned by store)
// ---------------------------------------------------------------------------

export interface TimelineEntryInput {
  direction: "in" | "out";
  platform: Platform;
  platformMessageId: string;
  platformChatId: string;
  platformChatType: string | null;
  senderName: string;
  senderId: string;
  text: string | null;
  timestamp: number;
  platformMeta: string | null;
}

// ---------------------------------------------------------------------------
// ChatRouterStore — JSON file-backed persistence
// ---------------------------------------------------------------------------

export class ChatRouterStore {
  private filePath: string | null;
  private state: StoreState;

  /**
   * @param filePath  Path to the JSON file. Pass `:memory:` or omit for
   *                  in-memory operation (ideal for tests).
   */
  constructor(filePath?: string) {
    this.filePath =
      filePath && filePath !== ":memory:" ? filePath : null;
    this.state = {
      timeline: [],
      conversations: [],
      nextTimelineId: 1,
      nextConversationId: 1,
    };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Load from file or initialise empty state. */
  init(): void {
    if (this.filePath && fs.existsSync(this.filePath)) {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      this.state = JSON.parse(raw) as StoreState;
    }
    // Otherwise keep the empty default state set in the constructor.
  }

  /** Save current state and clean up. */
  close(): void {
    this.persist();
  }

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------

  /** Insert a timeline entry, assigning `id` and `createdAt`. */
  insertTimelineEntry(entry: TimelineEntryInput): TimelineEntry {
    const record: TimelineEntry = {
      ...entry,
      id: this.state.nextTimelineId++,
      createdAt: new Date().toISOString(),
    };
    this.state.timeline.push(record);
    this.persist();
    return record;
  }

  /**
   * Create or update a conversation for the given (platform, platformChatId).
   * Increments messageCount and updates lastMessageAt.
   */
  upsertConversation(
    platform: Platform,
    platformChatId: string,
    label: string,
    chatType: string | null,
  ): Conversation {
    const existing = this.state.conversations.find(
      (c) => c.platform === platform && c.platformChatId === platformChatId,
    );

    const now = new Date().toISOString();

    if (existing) {
      existing.lastMessageAt = now;
      existing.messageCount += 1;
      // Update label and chatType in case they changed.
      existing.label = label;
      if (chatType !== null) {
        existing.platformChatType = chatType;
      }
      this.persist();
      return existing;
    }

    const conversation: Conversation = {
      id: this.state.nextConversationId++,
      platform,
      platformChatId,
      platformChatType: chatType,
      label,
      firstSeenAt: now,
      lastMessageAt: now,
      messageCount: 1,
    };
    this.state.conversations.push(conversation);
    this.persist();
    return conversation;
  }

  /**
   * Atomically insert a timeline entry and upsert the associated conversation.
   * Returns the inserted TimelineEntry.
   */
  ingestTransaction(
    entryData: TimelineEntryInput,
    label: string,
  ): TimelineEntry {
    const entry = this.insertTimelineEntry(entryData);
    this.upsertConversation(
      entryData.platform,
      entryData.platformChatId,
      label,
      entryData.platformChatType,
    );
    return entry;
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Timeline entries for a specific conversation, ordered by ID descending.
   * Supports cursor pagination via `before` (entries with id < before).
   */
  getTimeline(
    platform: Platform,
    platformChatId: string,
    before?: number,
    limit: number = 50,
  ): TimelineEntry[] {
    let entries = this.state.timeline.filter(
      (e) => e.platform === platform && e.platformChatId === platformChatId,
    );

    if (before !== undefined) {
      entries = entries.filter((e) => e.id < before);
    }

    // Sort by id descending (most recent first).
    entries.sort((a, b) => b.id - a.id);

    return entries.slice(0, limit);
  }

  /** All timeline entries ordered by ID descending with cursor pagination. */
  getUnifiedTimeline(before?: number, limit: number = 50): TimelineEntry[] {
    let entries = [...this.state.timeline];

    if (before !== undefined) {
      entries = entries.filter((e) => e.id < before);
    }

    entries.sort((a, b) => b.id - a.id);

    return entries.slice(0, limit);
  }

  /** List conversations ordered by lastMessageAt descending. */
  listConversations(platform?: Platform, limit: number = 50): Conversation[] {
    let convos = [...this.state.conversations];

    if (platform !== undefined) {
      convos = convos.filter((c) => c.platform === platform);
    }

    convos.sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() -
        new Date(a.lastMessageAt).getTime(),
    );

    return convos.slice(0, limit);
  }

  /** Single conversation lookup. */
  getConversation(
    platform: Platform,
    platformChatId: string,
  ): Conversation | null {
    return (
      this.state.conversations.find(
        (c) => c.platform === platform && c.platformChatId === platformChatId,
      ) ?? null
    );
  }

  /** Aggregate stats. */
  getStats(): { messageCount: number; conversationCount: number } {
    return {
      messageCount: this.state.timeline.length,
      conversationCount: this.state.conversations.length,
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private persist(): void {
    if (!this.filePath) return;

    // Ensure directory exists.
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
  }
}
