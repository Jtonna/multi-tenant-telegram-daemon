# Chat Router System: Implementation Details

For the layered design, data model definitions, and architectural overview, see [Architecture](architecture.md).

## REST API Endpoints

The API is mounted at the `/api` prefix. All request and response bodies are JSON.

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

**Query parameters:** `before` (cursor -- return entries with IDs less than this value), `limit` (default 50).

**Success:** Returns `200` with an array of `TimelineEntry` objects.

### GET /api/timeline

Returns the unified timeline across all platforms, ordered by ID descending.

**Query parameters:** `before` (cursor), `limit` (default 50).

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

### ingestMessage

Validates that all required fields are present on the `InboundMessage`. The fields `platform`, `platformMessageId`, `platformChatId`, `senderName`, and `senderId` are checked with falsy checks (rejecting empty strings and zero values). The `timestamp` field is checked only for `undefined`/`null` (allowing a timestamp of 0). The `text` field is not validated and may be omitted for non-text messages. Throws an `Error` with a descriptive message if any required field is missing.

Maps the `InboundMessage` to a `TimelineEntryInput` with `direction` `"in"`. Converts the `platformMeta` object to a JSON string via `JSON.stringify` (or `null` if absent). Sets `platformChatType` to `null` if not provided. Sets `text` to `null` if not provided. Calls the store's `ingestTransaction`, passing the sender's name as the conversation label.

### recordResponse

Validates that `platform`, `platformChatId`, and `text` are present (falsy checks). Generates a synthetic `platformMessageId` using an instance-level counter that increments on each call (format: `"router-N"` where N starts at 1). Creates the `TimelineEntryInput` with `direction` `"out"`, `senderName` `"System"`, `senderId` `"system"`, `platformChatType` `null`, and `timestamp` set to `Date.now()`. If `inReplyTo` is provided, it is stored in `platformMeta` as `JSON.stringify({ inReplyTo: <value> })`.

Calls the store's `ingestTransaction` with label `"System"`. This means if the conversation already exists, its label will be overwritten to `"System"`. Because `platformChatType` is always `null` for responses, an existing conversation's chat type will not be overwritten (the upsert only updates chat type when the new value is non-null).

### getTimeline

Delegates directly to the store, passing `platform`, `platformChatId`, and optional `before` cursor and `limit` parameters.

### getUnifiedTimeline

Delegates directly to the store with optional `before` cursor and `limit` parameters. Returns entries across all platforms.

### listConversations

Delegates directly to the store with an optional `platform` filter and optional `limit`. Does not support cursor-based pagination.

### getConversation

Delegates directly to the store, passing `platform` and `platformChatId` as positional arguments. Returns a single `Conversation` or `null`.

### healthCheck

Returns `{ ok: true, messageCount: <number>, conversationCount: <number> }` by calling the store's `getStats()` method.

## Store Internals

### State Shape

The store holds all state in memory as a single `StoreState` object containing four fields:

- `timeline` -- array of `TimelineEntry` objects
- `conversations` -- array of `Conversation` objects
- `nextTimelineId` -- auto-increment counter for timeline entries (starts at 1)
- `nextConversationId` -- auto-increment counter for conversations (starts at 1)

### Initialization and Lifecycle

The constructor accepts an optional file path. Passing `":memory:"` or omitting the path creates an in-memory store with no file I/O. The constructor does **not** load persisted state; the `init()` method must be called separately after construction to read from the file (if it exists). If `init()` is not called, the store starts with empty state regardless of file contents.

The `close()` method calls `persist()` one final time. There are no other resources to clean up.

### Persistence Mechanics

On each mutation (`insertTimelineEntry` or `upsertConversation`), if a file path was provided at construction, the store serializes the entire `StoreState` to JSON with two-space indentation and writes it to disk synchronously via `fs.writeFileSync`. If the directory does not exist, it is created recursively. In-memory mode (no file path) skips all file I/O, making tests fast and deterministic.

### ingestTransaction

Performs two operations in sequence:

1. **insertTimelineEntry** -- Assigns the next auto-increment `id`, sets `createdAt` to the current ISO 8601 timestamp, appends the entry to the timeline array, and calls `persist()`.
2. **upsertConversation** -- Looks up an existing conversation by `(platform, platformChatId)`. If found, updates `lastMessageAt`, increments `messageCount` by 1, overwrites `label`, and updates `platformChatType` only if the new value is non-null. If not found, creates a new `Conversation` with the next auto-increment ID, `messageCount` of 1, and `firstSeenAt`/`lastMessageAt` set to the current time. Then calls `persist()`.

Each step triggers its own `persist()` call. This means the compound operation is **not truly atomic** -- a crash between the two persists could leave the timeline entry saved but the conversation not updated.

### Query Behavior

- **getTimeline** -- Filters the timeline array by `platform` and `platformChatId`, optionally filters by `id < before`, sorts by ID descending, and returns up to `limit` entries (default 50).
- **getUnifiedTimeline** -- Same as `getTimeline` but without the platform/chat filter.
- **listConversations** -- Optionally filters by platform, sorts by `lastMessageAt` descending, and returns up to `limit` entries (default 50).
- **getConversation** -- Returns the first conversation matching `(platform, platformChatId)` or `null`.
- **getStats** -- Returns `{ messageCount, conversationCount }` based on the lengths of the `timeline` and `conversations` arrays.

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
