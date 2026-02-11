# Chat Router System: Implementation Details

## REST API Endpoints

The API is mounted at the /api prefix. All request and response bodies are JSON.

### POST /api/messages

Ingests an inbound message from a platform plugin. The request body must contain: platform (one of "telegram", "discord", or "web"), platformMessageId, platformChatId, senderName, senderId, and timestamp (Unix milliseconds). Optional fields include platformChatType, text, and platformMeta. Returns the created timeline entry with its assigned ID and direction set to "in". Returns 400 if any required field is missing.

### POST /api/responses

Records an outbound response. The request body must contain: platform, platformChatId, and text. An optional inReplyTo field references the timeline entry ID being replied to. The service generates a synthetic message ID (prefixed with "router-") and sets direction to "out". Returns 201 with the created timeline entry. Returns 400 if required fields are missing.

### GET /api/timeline/:platform/:chatId

Returns timeline entries for a specific conversation, ordered by ID descending (most recent first). Supports cursor-based pagination via the "before" query parameter (get entries with IDs less than this value) and a "limit" parameter (default 50). The platform and chatId are path parameters.

### GET /api/timeline

Returns the unified timeline across all platforms, ordered by ID descending. Supports the same "before" and "limit" pagination parameters.

### GET /api/conversations

Lists all known conversations, ordered by most recent activity. Supports a "platform" query parameter to filter by platform and a "limit" parameter (default 20).

### GET /api/conversations/:platform/:chatId

Returns a single conversation by its platform and chat ID. Returns 404 if the conversation does not exist.

### GET /api/health

Returns the system health status including whether the service is operational, the total message count, and the total conversation count.

## Service Methods

### ingestMessage

Validates that all required fields are present and non-empty: platform, platformMessageId, platformChatId, senderName, senderId, and timestamp. Throws an error with a descriptive message if any are missing. Maps the InboundMessage to a TimelineEntry with direction "in", serializes platformMeta to JSON if present, and calls the store's ingestTransaction which atomically inserts the entry and upserts the conversation.

### recordResponse

Validates platform, platformChatId, and text. Generates a synthetic platform message ID using an internal counter (format: "router-N"). Creates the timeline entry with direction "out", senderName "System", senderId "system", and the current timestamp. If inReplyTo is provided, it is stored in the platformMeta field.

### getTimeline, getUnifiedTimeline, listConversations, getConversation

These are pass-through query methods that delegate directly to the store. They accept pagination parameters (before cursor and limit) and filtering parameters (platform).

### healthCheck

Returns an object with ok set to true and the current message and conversation counts from the store.

## Store Internals

The store holds all state in memory as a single object containing four fields: an array of timeline entries, an array of conversations, and two auto-increment counters (one for each).

On each mutation (insert or upsert), if a file path was provided at construction, the store serializes the entire state to JSON and writes it to disk. On initialization, if the file exists, the store reads and parses it to restore state.

The ingestTransaction method performs two operations in sequence: it inserts a new timeline entry (assigning the next auto-increment ID and an ISO 8601 createdAt timestamp), then upserts the conversation. Upsert means: if a conversation with the same platform and platformChatId already exists, update its lastMessageAt and increment its messageCount; if not, create a new conversation with messageCount 1.

The in-memory mode (constructed with no path or ":memory:") skips all file I/O, making tests fast and deterministic.

## Error Handling

The REST API maps errors to HTTP status codes:

- **400 Bad Request** -- Returned when the service layer's validation throws an error (missing required fields, invalid inputs). The error message is included in the response body.
- **404 Not Found** -- Returned by the GET conversation endpoint when no matching conversation exists.
- **500 Internal Server Error** -- Returned by the global Express error handler for unexpected errors. The actual error is logged to the console; a generic message is sent to the client.

## Testing Approach

All tests use vitest and run against an in-memory store. No tests require a running server, network access, or real data.

- **Store tests** (9 tests) -- Cover initialization, insert/retrieve, conversation auto-creation, message count incrementing, cursor-based pagination, unified timeline across platforms, conversation ordering by recency, platform filtering, and null return for unknown conversations.
- **Service tests** (12 tests) -- Cover valid ingestion, six different validation error cases (one per required field), outbound entry creation, conversation-scoped timeline queries, multi-platform conversation listing, health check counts, and a full round-trip test that verifies all fields are preserved through ingest and retrieval.
- **API tests** (12 tests) -- Use supertest against the Express app (no actual HTTP server). Cover all seven endpoints with success and error cases, including pagination query parameters, platform filtering, and 404 responses.

Total: 33 tests across 3 test files.
