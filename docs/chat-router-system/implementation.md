# Chat Router System: Implementation Details

For the layered design, data model definitions, and architectural overview, see [Architecture](architecture.md).

## REST API Endpoints

The Express server applies CORS middleware (via the `cors` package) permitting requests from any origin. Middleware order: `cors()`, then `express.json()`, then route mounting at the `/api` prefix. All request and response bodies are JSON.

### POST /api/messages

Ingests an inbound message from a platform plugin.

**Required body fields:** `platform` (one of `"telegram"`, `"discord"`, or `"web"`), `platformMessageId`, `platformChatId`, `senderName`, `senderId`, `timestamp` (Unix milliseconds).

**Optional body fields:** `platformChatType`, `text`, `platformMeta` (object).

**Success:** Returns `201` with the created `TimelineEntry` including its assigned `id`, `direction` set to `"in"`, and `createdAt` timestamp.

**Error:** Returns `400` with `{ "error": "<message>" }` if any required field is missing.

### POST /api/responses

Records an outbound response.

**Required body fields:** `platform`, `platformChatId`, `text`.

**Optional body fields:** `inReplyTo` (timeline entry ID being replied to).

**Success:** Returns `201` with the created `TimelineEntry` including a synthetic `platformMessageId` (format: `"router-N"`), `direction` set to `"out"`, `senderName` `"System"`, and `senderId` `"system"`. If `inReplyTo` was provided, it is stored as serialized JSON in the `platformMeta` field.

**Error:** Returns `400` with `{ "error": "<message>" }` if any required field is missing.

### GET /api/timeline/:platform/:chatId

Returns timeline entries for a specific conversation, ordered by ID descending (most recent first).

**Path parameters:** `platform`, `chatId`.

**Query parameters:** `after` (cursor -- return entries with IDs greater than this value), `before` (cursor -- return entries with IDs less than this value), `limit` (default 50).

**Success:** Returns `200` with an array of `TimelineEntry` objects.

### GET /api/timeline

Returns the unified timeline across all platforms, ordered by ID descending.

**Query parameters:** `after` (cursor), `before` (cursor), `limit` (default 50).

**Success:** Returns `200` with an array of `TimelineEntry` objects.

### GET /api/conversations

Lists all known conversations, ordered by `lastMessageAt` descending (most recent first).

**Query parameters:** `platform` (filter to a single platform), `limit` (default 50).

**Success:** Returns `200` with an array of `Conversation` objects.

### GET /api/conversations/:platform/:chatId

Returns a single conversation by its platform and chat ID.

**Path parameters:** `platform`, `chatId`.

**Success:** Returns `200` with a `Conversation` object.

**Error:** Returns `404` with `{ "error": "Conversation not found" }` if no matching conversation exists.

### GET /api/health

Returns the system health status.

**Success:** Returns `200` with `{ "ok": true, "messageCount": <number>, "conversationCount": <number> }`.

## Service Methods

`ChatRouterService` implements the `IChatRouterService` interface defined in `types.ts`.

### ingestMessage

Validates that all required fields are present on the `InboundMessage` and throws an `Error` with a descriptive message if any are missing.

Maps the `InboundMessage` to a `TimelineEntryInput` with `direction` `"in"`. Converts the `platformMeta` object to a JSON string via `JSON.stringify` (or `null` if absent). Sets `platformChatType` and `text` to `null` if not provided. Calls the store's `ingestTransaction`, passing the sender's name as the conversation label.

### recordResponse

Validates that `platform`, `platformChatId`, and `text` are present (falsy checks). Generates a synthetic `platformMessageId` using an instance-level counter that increments on each call (format: `"router-N"` where N starts at 1). Creates the `TimelineEntryInput` with `direction` `"out"`, `senderName` `"System"`, `senderId` `"system"`, `platformChatType` `null`, and `timestamp` set to `Date.now()`. If `inReplyTo` is provided, it is stored in `platformMeta` as `JSON.stringify({ inReplyTo: <value> })`.

Calls the store's `ingestTransaction` with label `"System"`.

### getTimeline

Delegates directly to the store, passing `platform`, `platformChatId`, and optional `after` cursor, `before` cursor, and `limit` parameters.

### getUnifiedTimeline

Delegates directly to the store with optional `after` cursor, `before` cursor, and `limit` parameters. Returns entries across all platforms.

### listConversations

Delegates directly to the store with an optional `platform` filter and optional `limit`. Does not support cursor-based pagination.

### getConversation

Delegates directly to the store, passing `platform` and `platformChatId` as positional arguments. Returns a single `Conversation` or `null`.

### healthCheck

Returns `{ ok: true, messageCount: <number>, conversationCount: <number> }` by calling the store's `getStats()` method.

## Store Internals

### State Shape

The store delegates all state to a SQLite database via `better-sqlite3`. Two tables are created on `init()`:

- `timeline` -- one row per message, with `id INTEGER PRIMARY KEY AUTOINCREMENT` and an index on `(platform, platform_chat_id)`.
- `conversations` -- one row per unique `(platform, platform_chat_id)` pair, with a `UNIQUE` constraint on those columns and a corresponding index.

Auto-increment IDs are managed by SQLite, not by application-level counters. Query results are mapped from SQLite snake_case columns to camelCase TypeScript interfaces via internal helper functions.

### Initialization and Lifecycle

The constructor accepts an optional file path. Passing `":memory:"` or omitting the path creates an in-memory SQLite database. The `init()` method must be called after construction; it opens the database connection, enables WAL journal mode for file-based databases via `PRAGMA journal_mode = WAL`, and runs idempotent DDL (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`). If the parent directory for a file-based database does not exist, it is created recursively. If `init()` is not called, any subsequent operation throws.

The `close()` method closes the SQLite database connection and nulls the reference. Any subsequent store operation will throw.

### Persistence

All mutations execute SQL statements through `better-sqlite3` prepared statements. SQLite handles durability transparently -- file-based databases use WAL journal mode (set during `init()`), while in-memory databases (`:memory:`) are ephemeral, making tests fast and deterministic. There is no application-level serialization or explicit file I/O.

### ingestTransaction

Wraps two operations in a SQLite transaction via `db.transaction()`. The compound operation is atomic -- if either step fails, the entire transaction rolls back.

1. **insertTimelineEntry** -- Sets `createdAt` to the current ISO 8601 timestamp, executes an `INSERT` statement, and reads back the auto-assigned `id` from `lastInsertRowid`.
2. **upsertConversation** -- Executes an `INSERT ... ON CONFLICT DO UPDATE` statement. On insert: sets `message_count` to 1 and `first_seen_at`/`last_message_at` to the current time. On conflict: increments `message_count`, updates `last_message_at` and `label`, and updates `platform_chat_type` only if the new value is non-null. The full row is then read back via `SELECT`.

### Query Behavior

- **getTimeline** -- `SELECT * FROM timeline WHERE platform = ? AND platform_chat_id = ?` with optional `id > after` and `id < before` conditions, `ORDER BY id DESC`, `LIMIT ?` (default 50).
- **getUnifiedTimeline** -- Same query without the platform/chat filter. Supports both `after` and `before` cursors.
- **listConversations** -- `SELECT * FROM conversations` with optional `WHERE platform = ?`, `ORDER BY last_message_at DESC`, `LIMIT ?` (default 50).
- **getConversation** -- `SELECT * FROM conversations WHERE platform = ? AND platform_chat_id = ?`. Returns a single `Conversation` or `null`.
- **getStats** -- Returns `{ messageCount, conversationCount }` from two `SELECT COUNT(*)` queries.

## Startup and Shutdown

The entry point (`index.ts`) reads `CHAT_ROUTER_PORT` (default `3100`) and `CHAT_ROUTER_DATA_DIR` (default `./data`) from environment variables. The SQLite database file is `${DATA_DIR}/chat-router.db`. On `SIGINT` or `SIGTERM` the HTTP server is closed first, then the store connection.

## Error Handling

The REST API maps errors to HTTP status codes:

- **400 Bad Request** -- Returned when the service layer's validation throws an error (missing required fields, invalid inputs). The route handler catches the error and responds with `{ "error": "<message>" }`.
- **404 Not Found** -- Returned by `GET /api/conversations/:platform/:chatId` when no matching conversation exists. Response body: `{ "error": "Conversation not found" }`.
- **500 Internal Server Error** -- Returned by the global Express error handler for unexpected errors. The actual error is logged to the console. Response body: `{ "error": "Internal server error" }`.

## Testing Approach

All tests use vitest and run against an in-memory store (constructed with `":memory:"`). No tests require a running server, network access, or file system writes.

- **Store tests** (`store.test.ts`, 9 tests) -- Cover empty initialization, insert and retrieve, conversation auto-creation via `ingestTransaction`, `messageCount` incrementing on subsequent messages, timeline ordering with cursor-based pagination, unified timeline across platforms, conversation listing ordered by recency, platform filtering on conversations, and `null` return for unknown conversations.

- **Service tests** (`service.test.ts`, 12 tests) -- Cover valid ingestion with field verification, six validation error cases (one per required field: `platform`, `platformMessageId`, `platformChatId`, `senderName`, `senderId`, `timestamp`), outbound entry creation via `recordResponse`, conversation-scoped timeline queries, multi-platform conversation listing, health check counts, and a full round-trip test verifying all fields are preserved through ingest and retrieval (including `platformMeta` serialization).

- **API tests** (`api.test.ts`, 12 tests) -- Use supertest against the Express app (no actual HTTP server started). Cover all seven endpoints with success and error cases: message ingestion (valid and invalid), response recording (valid and missing text), conversation-scoped timeline with pagination, unified timeline across platforms, conversation listing with platform filter, single conversation lookup with 404 case, and health check.

Total: 33 tests across 3 test files.
