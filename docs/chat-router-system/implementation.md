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

**Success:** Returns `201` with the created `TimelineEntry` including a synthetic `platformMessageId` (format: `"router-N"`), `direction` set to `"out"`, `senderName` `"System"`, and `senderId` `"system"`. If `inReplyTo` was provided (checked via `!== undefined`), it is stored as serialized JSON in the `platformMeta` field.

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

`ChatRouterService` extends `EventEmitter` and implements the `IChatRouterService` interface defined in `types.ts`. The constructor calls `super()` and accepts a `ChatRouterStore` instance. The EventEmitter base class enables real-time push notifications -- both mutation methods emit a `"message:new"` event after the store transaction completes, which the WebSocket adapter listens on to broadcast to connected clients.

### ingestMessage

Validates that all required fields are present on the `InboundMessage` and throws an `Error` with a descriptive message if any are missing. Most fields use falsy checks (`!field`), but `timestamp` uses a nullish check (`=== undefined || === null`), meaning `timestamp: 0` passes validation while `text: ""` would fail in other methods.

Maps the `InboundMessage` to a `TimelineEntryInput` with `direction` `"in"`. Converts the `platformMeta` object to a JSON string via `JSON.stringify` (or `null` if absent). Sets `platformChatType` and `text` to `null` if not provided. Calls the store's `ingestTransaction`, passing the sender's name as the conversation label. After the transaction completes, emits a `"message:new"` event with the created `TimelineEntry`.

### recordResponse

Validates that `platform`, `platformChatId`, and `text` are present (falsy checks). Generates a synthetic `platformMessageId` using an instance-level counter that increments on each call (format: `"router-N"` where N starts at 1). Creates the `TimelineEntryInput` with `direction` `"out"`, `senderName` `"System"`, `senderId` `"system"`, `platformChatType` `null`, and `timestamp` set to `Date.now()`. If `inReplyTo` is provided (`!== undefined`), it is stored in `platformMeta` as `JSON.stringify({ inReplyTo: <value> })`.

Calls the store's `ingestTransaction` with label `"System"`. After the transaction completes, emits a `"message:new"` event with the created `TimelineEntry`.

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

## CLI Adapter

The `chat-router` package doubles as a CLI tool for interacting with a running daemon. The CLI subsystem lives in `cli/adapter.ts` and `cli/client.ts`, with the `npm run cli` script (`tsx src/index.ts`) as the entry point.

### Mode Detection

The entry point (`index.ts`) checks `process.argv[2]` against a list of known commands (`health`, `conversations`, `timeline`, `ingest`, `respond`) via `isCliCommand()`. If the argument matches, `runCli()` is called with the remaining args instead of starting the daemon server.

### ChatRouterClient

`ChatRouterClient` (`cli/client.ts`) is an HTTP client that talks to the running daemon using native `fetch`. The constructor takes a `baseUrl` string parameter (no default -- the caller in `adapter.ts` reads `CHAT_ROUTER_URL` from the environment, falling back to `http://localhost:3100`). Methods: `health()`, `conversations()`, `timeline()`, `unifiedTimeline()`, `ingest()`, `respond()`. Each method maps to the corresponding REST endpoint. Non-2xx responses throw an `Error` with the status code and response body.

### Argument Parsing

`parseArgs()` in `adapter.ts` is a minimal custom parser supporting `--key value` flags and positional arguments. No external library is used. Boolean-style flags (no following value) are stored as `"true"`.

### stdin Support

The `ingest` and `respond` commands accept JSON either via `--json '...'` flag or by reading from stdin when `--json` is not provided.

## WebSocket Adapter

The WebSocket subsystem lives in `ws/adapter.ts` and `ws/protocol.ts`. It provides both request/response queries and real-time push notifications over a single connection.

### Attachment

`attachWebSocket(server, service)` is called after `app.listen()` in daemon mode. It creates a `WebSocketServer` (from the `ws` package, `^8.19.0`) attached to the HTTP server at path `/ws`.

### Protocol

The protocol types are defined in `ws/protocol.ts`:

- **`WsRequest`** (client to server) -- a discriminated union on the `type` field: `"health"`, `"conversations"` (optional `platform`, `limit`), `"timeline"` (required `platform`, `platformChatId`; optional `after`, `before`, `limit`), `"unified_timeline"` (optional `after`, `before`, `limit`).
- **`WsResponse`** (server to client) -- `{ type: "response", requestType: string, data: unknown }`. Sent in reply to a request.
- **`WsPush`** (server to client) -- `{ type: "new_message", entry: TimelineEntry }`. Broadcast when a message is ingested or a response is recorded.
- **`WsError`** (server to client) -- `{ type: "error", message: string }`. Sent for malformed JSON or unknown request types.

### Real-time Push

The adapter listens on `service.on("message:new")` and broadcasts a `WsPush` message to all connected clients whose `readyState` is `OPEN`. This is how `ingestMessage` and `recordResponse` events reach WebSocket clients without polling.

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

Wraps two operations in a SQLite transaction via `db.transaction()`. The compound operation is atomic -- if either step fails, the entire transaction rolls back. Returns the created `TimelineEntry` (not the `Conversation`).

1. **insertTimelineEntry** -- Sets `createdAt` to the current ISO 8601 timestamp, inserts the row, and reads back the auto-assigned `id` from `lastInsertRowid`.
2. **upsertConversation** -- Inserts or updates the conversation record. On insert: sets `message_count` to 1 and timestamps. On conflict: increments `message_count`, updates `last_message_at` and `label`, and updates `platform_chat_type` only if the new value is non-null.

### Query Behavior

- **getTimeline** -- Retrieves timeline entries for a specific conversation with optional `after`/`before` cursor filtering, ordered by `id DESC`, limited to 50 by default.
- **getUnifiedTimeline** -- Same as `getTimeline` but without the platform/chat filter. Supports both `after` and `before` cursors.
- **listConversations** -- Retrieves all conversations with optional platform filter, ordered by `last_message_at DESC`, limited to 50 by default.
- **getConversation** -- Retrieves a single conversation by platform and chat ID, or returns `null`.
- **getStats** -- Returns `{ messageCount, conversationCount }` from two count queries.

## Startup and Shutdown

The entry point (`index.ts`) operates in one of two modes:

1. **CLI mode** -- If `process.argv[2]` matches a known CLI command (via `isCliCommand()`), the process runs `runCli()` and exits when the command completes. No server is started.

2. **Daemon mode** -- Otherwise, the entry point reads `CHAT_ROUTER_PORT` (default `3100`) and `CHAT_ROUTER_DATA_DIR` (default `./data`) from environment variables. The SQLite database file is `${DATA_DIR}/chat-router.db`. After the Express app starts listening, `attachWebSocket(server, service)` is called to attach the WebSocket server. On `SIGINT` or `SIGTERM` the HTTP server is closed first (which also tears down the WebSocket server), then the store connection.

## Telegram Plugin Health Check

The Telegram integration (`telegram-integration/src/index.ts`) performs a startup health check against the chat router when `CHAT_ROUTER_URL` is configured. It calls `chatRouter.healthCheck()` and logs message/conversation counts on success. If the router is unreachable, it logs a warning but does not block bot startup -- the bot starts anyway and retries forwarding when messages arrive.

## Error Handling

The REST API maps errors to HTTP status codes:

- **400 Bad Request** -- Returned when the service layer's validation throws an error (missing required fields, invalid inputs). The route handler catches the error and responds with `{ "error": "<message>" }`.
- **404 Not Found** -- Returned by `GET /api/conversations/:platform/:chatId` when no matching conversation exists. Response body: `{ "error": "Conversation not found" }`.
- **500 Internal Server Error** -- Returned by the global Express error handler for unexpected errors. The actual error is logged to the console. Response body: `{ "error": "Internal server error" }`.

## Testing Approach

All tests use vitest. Most tests run against an in-memory store (constructed with `":memory:"`), but the store persistence tests write to real SQLite files in temp directories, and the WebSocket tests start a real HTTP server on a random port.

- **Store tests** (`store.test.ts`, 11 tests) -- Cover empty initialization, insert and retrieve, conversation auto-creation via `ingestTransaction`, `messageCount` incrementing on subsequent messages, timeline ordering with cursor-based pagination, unified timeline across platforms, conversation listing ordered by recency, platform filtering on conversations, `null` return for unknown conversations, data persistence across close and reopen, and data accumulation across multiple sessions. The last two tests use file-based SQLite databases in temp directories.

- **Service tests** (`service.test.ts`, 15 tests) -- Cover valid ingestion with field verification, six validation error cases (one per required field: `platform`, `platformMessageId`, `platformChatId`, `senderName`, `senderId`, `timestamp`), outbound entry creation via `recordResponse`, conversation-scoped timeline queries, multi-platform conversation listing, health check counts, a full round-trip test verifying all fields are preserved through ingest and retrieval (including `platformMeta` serialization), and three EventEmitter tests verifying that `ingestMessage` emits `"message:new"`, `recordResponse` emits `"message:new"`, and multiple listeners all receive the event.

- **API tests** (`api.test.ts`, 12 tests) -- Use supertest against the Express app (no actual HTTP server started). Cover all seven endpoints with success and error cases: message ingestion (valid and invalid), response recording (valid and missing text), conversation-scoped timeline with pagination, unified timeline across platforms, conversation listing with platform filter, single conversation lookup with 404 case, and health check.

- **CLI tests** (`cli.test.ts`, 9 tests) -- Cover `isCliCommand()` returning true for all five known commands (`health`, `conversations`, `timeline`, `ingest`, `respond`) and returning false for unknown commands, empty strings, wrong casing, and partial matches.

- **WebSocket tests** (`ws.test.ts`, 9 tests) -- Start a real HTTP server on a random port with a WebSocket adapter attached. Cover connection acceptance, `health`/`conversations`/`timeline`/`unified_timeline` request-response flows, malformed JSON error handling, unknown request type error handling, and real-time push on both `ingestMessage` and `recordResponse`.

Total: 56 tests across 5 test files.
