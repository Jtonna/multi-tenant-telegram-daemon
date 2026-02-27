import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import type {
  Platform,
  TimelineEntry,
  Conversation,
} from "../types";

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
// ChatRouterStore — SQLite-backed persistence (better-sqlite3)
// ---------------------------------------------------------------------------

export class ChatRouterStore {
  private db: Database.Database | null = null;
  private dbPath: string;

  /**
   * @param filePath  Path to the SQLite file. Pass `:memory:` or omit for
   *                  in-memory operation (ideal for tests).
   */
  constructor(filePath?: string) {
    this.dbPath = filePath && filePath !== ":memory:" ? filePath : ":memory:";
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Create tables / indexes (idempotent) and open the database. */
  init(): void {
    // Ensure the parent directory exists for file-based databases.
    if (this.dbPath !== ":memory:") {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new Database(this.dbPath);

    // Verify database uses UTF-8 encoding for emoji and Unicode support
    const encoding = this.db.pragma("encoding", { simple: true });
    if (encoding !== "UTF-8") {
      throw new Error(`Database encoding is "${encoding}", expected "UTF-8"`);
    }

    // Enable WAL mode for file-based databases for better concurrency.
    if (this.dbPath !== ":memory:") {
      this.db.pragma("journal_mode = WAL");
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS timeline (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        direction           TEXT    NOT NULL,
        platform            TEXT    NOT NULL,
        platform_message_id TEXT    NOT NULL,
        platform_chat_id    TEXT    NOT NULL,
        platform_chat_type  TEXT,
        sender_name         TEXT    NOT NULL,
        sender_id           TEXT    NOT NULL,
        text                TEXT,
        timestamp           INTEGER NOT NULL,
        platform_meta       TEXT,
        created_at          TEXT    NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_timeline_platform_chat
        ON timeline (platform, platform_chat_id);

      CREATE TABLE IF NOT EXISTS conversations (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        platform           TEXT    NOT NULL,
        platform_chat_id   TEXT    NOT NULL,
        platform_chat_type TEXT,
        label              TEXT    NOT NULL,
        first_seen_at      TEXT    NOT NULL,
        last_message_at    TEXT    NOT NULL,
        message_count      INTEGER NOT NULL DEFAULT 0,
        UNIQUE (platform, platform_chat_id)
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_platform_chat
        ON conversations (platform, platform_chat_id);
    `);
  }

  /** Close the database connection. */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------

  /** Insert a timeline entry, assigning `id` and `createdAt`. */
  insertTimelineEntry(entry: TimelineEntryInput): TimelineEntry {
    const db = this.getDb();
    const createdAt = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO timeline
        (direction, platform, platform_message_id, platform_chat_id,
         platform_chat_type, sender_name, sender_id, text, timestamp,
         platform_meta, created_at)
      VALUES
        (@direction, @platform, @platformMessageId, @platformChatId,
         @platformChatType, @senderName, @senderId, @text, @timestamp,
         @platformMeta, @createdAt)
    `);

    const result = stmt.run({
      direction: entry.direction,
      platform: entry.platform,
      platformMessageId: entry.platformMessageId,
      platformChatId: entry.platformChatId,
      platformChatType: entry.platformChatType,
      senderName: entry.senderName,
      senderId: entry.senderId,
      text: entry.text,
      timestamp: entry.timestamp,
      platformMeta: entry.platformMeta,
      createdAt,
    });

    return {
      ...entry,
      id: Number(result.lastInsertRowid),
      createdAt,
    };
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
    const db = this.getDb();
    const now = new Date().toISOString();

    // Try INSERT first with ON CONFLICT handling.
    // On conflict: update label, lastMessageAt, messageCount, and chatType
    // (only if provided value is not null).
    const stmt = db.prepare(`
      INSERT INTO conversations
        (platform, platform_chat_id, platform_chat_type, label,
         first_seen_at, last_message_at, message_count)
      VALUES
        (@platform, @platformChatId, @chatType, @label,
         @now, @now, 1)
      ON CONFLICT (platform, platform_chat_id) DO UPDATE SET
        label           = @label,
        last_message_at = @now,
        message_count   = message_count + 1,
        platform_chat_type = CASE
          WHEN @chatType IS NOT NULL THEN @chatType
          ELSE platform_chat_type
        END
    `);

    stmt.run({
      platform,
      platformChatId,
      chatType,
      label,
      now,
    });

    // Read back the row so we return the full, up-to-date Conversation.
    return this.getConversation(platform, platformChatId)!;
  }

  /**
   * Atomically insert a timeline entry and upsert the associated conversation.
   * Returns the inserted TimelineEntry.
   */
  ingestTransaction(
    entryData: TimelineEntryInput,
    label: string,
  ): TimelineEntry {
    const db = this.getDb();

    const txn = db.transaction(() => {
      const entry = this.insertTimelineEntry(entryData);
      this.upsertConversation(
        entryData.platform,
        entryData.platformChatId,
        label,
        entryData.platformChatType,
      );
      return entry;
    });

    return txn();
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  /**
   * Timeline entries for a specific conversation, ordered by ID descending.
   * Supports cursor pagination via `after` (id > after) and `before` (id < before).
   */
  getTimeline(
    platform: Platform,
    platformChatId: string,
    after?: number,
    before?: number,
    limit: number = 50,
  ): TimelineEntry[] {
    const db = this.getDb();
    const conditions = ["platform = ?", "platform_chat_id = ?"];
    const params: unknown[] = [platform, platformChatId];

    if (after !== undefined) {
      conditions.push("id > ?");
      params.push(after);
    }
    if (before !== undefined) {
      conditions.push("id < ?");
      params.push(before);
    }

    params.push(limit);
    const where = conditions.join(" AND ");
    const stmt = db.prepare(`
      SELECT * FROM timeline
      WHERE ${where}
      ORDER BY id DESC
      LIMIT ?
    `);
    return stmt.all(...params).map(rowToTimelineEntry);
  }

  /** All timeline entries ordered by ID descending with cursor pagination. */
  getUnifiedTimeline(after?: number, before?: number, limit: number = 50): TimelineEntry[] {
    const db = this.getDb();
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (after !== undefined) {
      conditions.push("id > ?");
      params.push(after);
    }
    if (before !== undefined) {
      conditions.push("id < ?");
      params.push(before);
    }

    params.push(limit);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const stmt = db.prepare(`
      SELECT * FROM timeline
      ${where}
      ORDER BY id DESC
      LIMIT ?
    `);
    return stmt.all(...params).map(rowToTimelineEntry);
  }

  /** List conversations ordered by lastMessageAt descending. */
  listConversations(platform?: Platform, limit: number = 50): Conversation[] {
    const db = this.getDb();

    if (platform !== undefined) {
      const stmt = db.prepare(`
        SELECT * FROM conversations
        WHERE platform = ?
        ORDER BY last_message_at DESC
        LIMIT ?
      `);
      return stmt.all(platform, limit).map(rowToConversation);
    }

    const stmt = db.prepare(`
      SELECT * FROM conversations
      ORDER BY last_message_at DESC
      LIMIT ?
    `);
    return stmt.all(limit).map(rowToConversation);
  }

  /** Single conversation lookup. */
  getConversation(
    platform: Platform,
    platformChatId: string,
  ): Conversation | null {
    const db = this.getDb();
    const stmt = db.prepare(`
      SELECT * FROM conversations
      WHERE platform = ? AND platform_chat_id = ?
    `);
    const row = stmt.get(platform, platformChatId) as Record<string, unknown> | undefined;
    return row ? rowToConversation(row) : null;
  }

  /** Aggregate stats. */
  getStats(): { messageCount: number; conversationCount: number } {
    const db = this.getDb();

    const msgRow = db.prepare("SELECT COUNT(*) AS cnt FROM timeline").get() as {
      cnt: number;
    };
    const convoRow = db
      .prepare("SELECT COUNT(*) AS cnt FROM conversations")
      .get() as { cnt: number };

    return {
      messageCount: msgRow.cnt,
      conversationCount: convoRow.cnt,
    };
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private getDb(): Database.Database {
    if (!this.db) {
      throw new Error("ChatRouterStore: database not initialised — call init() first");
    }
    return this.db;
  }
}

// ---------------------------------------------------------------------------
// Row-to-interface mappers (snake_case -> camelCase)
// ---------------------------------------------------------------------------

function rowToTimelineEntry(row: unknown): TimelineEntry {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as number,
    direction: r.direction as "in" | "out",
    platform: r.platform as Platform,
    platformMessageId: r.platform_message_id as string,
    platformChatId: r.platform_chat_id as string,
    platformChatType: (r.platform_chat_type as string | null) ?? null,
    senderName: r.sender_name as string,
    senderId: r.sender_id as string,
    text: (r.text as string | null) ?? null,
    timestamp: r.timestamp as number,
    platformMeta: (r.platform_meta as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

function rowToConversation(row: unknown): Conversation {
  const r = row as Record<string, unknown>;
  return {
    id: r.id as number,
    platform: r.platform as Platform,
    platformChatId: r.platform_chat_id as string,
    platformChatType: (r.platform_chat_type as string | null) ?? null,
    label: r.label as string,
    firstSeenAt: r.first_seen_at as string,
    lastMessageAt: r.last_message_at as string,
    messageCount: r.message_count as number,
  };
}
