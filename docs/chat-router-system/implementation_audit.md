# Chat Router System: Documentation Audit

Audit performed on 2026-02-10 against source code on the `phase-0` branch.

Files reviewed:
- docs/chat-router-system/index.md
- docs/chat-router-system/architecture.md
- docs/chat-router-system/implementation.md
- chat-router/src/types.ts
- chat-router/src/service.ts
- chat-router/src/db/store.ts
- chat-router/src/api/router.ts
- chat-router/src/api/server.ts
- chat-router/src/index.ts
- chat-router/src/__tests__/api.test.ts
- chat-router/src/__tests__/service.test.ts
- chat-router/src/__tests__/store.test.ts

---

## Findings

### 1. Inaccuracy: POST /api/messages return status code

- **Category**: Inaccuracy
- **Location**: implementation.md, "POST /api/messages" section
- **Issue**: The docs do not specify the success status code for POST /api/messages. The description says "Returns the created timeline entry with its assigned ID and direction set to 'in'" but omits the 201 status code. In contrast, the POST /api/responses section explicitly states "Returns 201." The omission is inconsistent and could lead a reader to assume 200.
- **Evidence**: In `api/router.ts` line 15, the POST /messages handler calls `res.status(201).json(entry)`. The API tests confirm this: `expect(201)` on line 48 of `api.test.ts`.

### 2. Inaccuracy: listConversations default limit

- **Category**: Inaccuracy
- **Location**: implementation.md, "GET /api/conversations" section
- **Issue**: The docs state the default limit for the conversations list is 20: "a 'limit' parameter (default 20)."
- **Evidence**: In `store.ts` line 198, the `listConversations` method signature is `listConversations(platform?: Platform, limit: number = 50)`. The default limit is 50, not 20.

### 3. Contradiction: recordResponse uses store.ingestTransaction, not just insert

- **Category**: Clarification
- **Location**: implementation.md, "recordResponse" section
- **Issue**: The docs say recordResponse "Creates the timeline entry with direction 'out'" without specifying that it also upserts the conversation via `ingestTransaction`. This implies it only inserts a timeline entry, but the actual code goes through the same `ingestTransaction` path as `ingestMessage`, meaning every outbound response also upserts the conversation record (incrementing messageCount and updating lastMessageAt).
- **Evidence**: In `service.ts` line 82, `recordResponse` calls `this.store.ingestTransaction(entryData, "System")`. This means outbound responses count toward the conversation's messageCount and update lastMessageAt, and can even create new conversations if one doesn't already exist for that platform+chatId pair.

### 4. Missing: Conversation label and chatType are updated on every message

- **Category**: Missing
- **Location**: architecture.md, "Persistence" section; implementation.md, "Store Internals" section
- **Issue**: The docs describe the conversation upsert as: "if a conversation with the same platform and platformChatId already exists, update its lastMessageAt and increment its messageCount; if not, create a new conversation with messageCount 1." This omits that the upsert also updates the conversation's `label` and conditionally updates `platformChatType` (if the new value is non-null) on every message.
- **Evidence**: In `store.ts` lines 114-118:
  ```typescript
  existing.label = label;
  if (chatType !== null) {
    existing.platformChatType = chatType;
  }
  ```

### 5. Missing: recordResponse passes "System" as the conversation label

- **Category**: Missing
- **Location**: implementation.md, "recordResponse" section
- **Issue**: The docs do not mention that when `recordResponse` calls `ingestTransaction`, it passes `"System"` as the conversation label. This means if a response is recorded for a conversation that already exists, the conversation's label will be overwritten to "System" (since the upsert always updates label). If `recordResponse` is called for a platform+chatId that has no prior inbound message, it will create a conversation labeled "System".
- **Evidence**: In `service.ts` line 82: `return this.store.ingestTransaction(entryData, "System")`.

### 6. Inaccuracy: ingestTransaction is not truly atomic

- **Category**: Ambiguity
- **Location**: architecture.md, "Data Flow" step 5; implementation.md, "Store Internals" section
- **Issue**: The docs describe the ingest operation as "atomically inserts the timeline entry and upserts the conversation record." However, the implementation performs two sequential operations with separate `persist()` calls. `insertTimelineEntry` calls `persist()` once, then `upsertConversation` calls `persist()` again. In the JSON file-backed mode, if the process crashes between the first and second persist, the timeline entry would be saved but the conversation would not be updated.
- **Evidence**: In `store.ts`, `ingestTransaction` (lines 142-154) calls `this.insertTimelineEntry(entryData)` (which calls `persist()` at line 91) and then `this.upsertConversation(...)` (which calls `persist()` at line 119 or 134). Two separate writes to disk occur.

### 7. Missing: Conversation model includes platformChatType field

- **Category**: Missing
- **Location**: architecture.md, "The Normalized Message Model" section
- **Issue**: The docs describe the Conversation model as storing "a display label, first-seen and last-message timestamps, and a running message count." It omits the `platformChatType` field, which is part of the Conversation interface and is set from the inbound message data.
- **Evidence**: In `types.ts` lines 73-85, the `Conversation` interface includes `platformChatType: string | null`.

### 8. Missing: Store constructor initializes auto-increment counters starting at 1

- **Category**: Clarification
- **Location**: implementation.md, "Store Internals" section
- **Issue**: The docs mention "two auto-increment counters (one for each)" but don't specify their starting values.
- **Evidence**: In `store.ts` lines 56-57: `nextTimelineId: 1` and `nextConversationId: 1`. The first timeline entry gets ID 1, the first conversation gets ID 1.

### 9. Ambiguity: "seven endpoints" count

- **Category**: Clarification
- **Location**: index.md, "What It Does Today" section
- **Issue**: The docs say "seven endpoints." The actual count of unique route handlers in `router.ts` is seven: POST /messages, POST /responses, GET /timeline/:platform/:chatId, GET /timeline, GET /conversations, GET /conversations/:platform/:chatId, GET /health. This is correct, but the sentence "An Express-based HTTP server that exposes seven endpoints for submitting messages, retrieving timelines, listing conversations, and checking system health" omits recording responses as a described action.
- **Evidence**: In `router.ts`, there are seven `router.[get|post]` calls. The text describes four activities but there are five logical operations: submitting messages, recording responses, retrieving timelines, listing/getting conversations, and checking health.

### 10. Missing: Timestamp validation uses different logic than other fields

- **Category**: Missing
- **Location**: implementation.md, "ingestMessage" section
- **Issue**: The docs say the service "Validates that all required fields are present and non-empty." For timestamp, the code uses a different validation check than the other fields. The other five fields use falsy checks (`!msg.field`), which would reject empty strings and zero values. Timestamp specifically checks `msg.timestamp === undefined || msg.timestamp === null`, meaning a timestamp of `0` would pass validation (while an empty string for senderName would fail).
- **Evidence**: In `service.ts` lines 137-154:
  ```typescript
  if (!msg.platform) { ... }
  if (!msg.platformMessageId) { ... }
  // ...
  if (msg.timestamp === undefined || msg.timestamp === null) { ... }
  ```

### 11. Missing: Store init() must be called before use

- **Category**: Missing
- **Location**: implementation.md, "Store Internals" section; architecture.md, "Persistence" section
- **Issue**: The docs mention that "if the file exists, the store reads and parses it to restore state" but don't explicitly call out that `init()` is a separate method that must be called after construction. The constructor does not call `init()`. If a consumer forgets to call `init()`, file-backed state will never be loaded.
- **Evidence**: In `store.ts`, the constructor (lines 50-58) only sets `filePath` and creates empty state. The `init()` method (lines 66-72) is separate. In `index.ts` lines 8-9, the store is constructed and then `store.init()` is called as a separate step. All test files also call `store.init()` after construction.

### 12. Missing: Store close() only persists, no other cleanup

- **Category**: Clarification
- **Location**: architecture.md, "Configuration" section
- **Issue**: The docs say the server performs "graceful shutdown on SIGINT and SIGTERM, closing the HTTP server and flushing the store to disk." This is accurate but could clarify that the store's `close()` method is simply a call to `persist()`. There is no resource cleanup (no file handles to close, no connections to terminate). The in-memory store's `close()` is a no-op since `persist()` returns early when there is no file path.
- **Evidence**: In `store.ts` lines 75-77:
  ```typescript
  close(): void {
    this.persist();
  }
  ```

### 13. Missing: The server factory does not call listen()

- **Category**: Missing
- **Location**: architecture.md; implementation.md
- **Issue**: The docs describe the REST API as "An Express-based HTTP server" but don't mention the architectural detail that `createServer()` returns an Express app without calling `.listen()`. The `listen()` call happens in `index.ts`. This separation is important because it enables testability with supertest (no actual HTTP server needed for tests).
- **Evidence**: In `server.ts` lines 9-25, `createServer()` returns `app` without calling `.listen()`. In `index.ts` line 13, `app.listen(PORT, ...)` is called separately.

### 14. Ambiguity: "serializing platformMeta to JSON" implies double serialization

- **Category**: Ambiguity
- **Location**: architecture.md, "Data Flow" step 4; implementation.md, "ingestMessage" section
- **Issue**: The docs say the service "serializes platformMeta to JSON if present." This is correct, but the phrasing could be misread. The InboundMessage's `platformMeta` field is a `Record<string, unknown>` (a JavaScript object). The service calls `JSON.stringify()` on it to produce a string for storage. The TimelineEntry's `platformMeta` field is `string | null`. The docs should be more explicit that the transformation is from a JS object to a JSON string, since both the input and output could colloquially be called "JSON."
- **Evidence**: In `service.ts` lines 40-42:
  ```typescript
  platformMeta: msg.platformMeta
    ? JSON.stringify(msg.platformMeta)
    : null,
  ```

### 15. Inaccuracy: getConversation takes two separate parameters, not a params object

- **Category**: Clarification
- **Location**: implementation.md, "getTimeline, getUnifiedTimeline, listConversations, getConversation" section
- **Issue**: The docs lump all four query methods together and say "They accept pagination parameters (before cursor and limit) and filtering parameters (platform)." This implies all four accept pagination parameters. In fact, `getConversation` takes only `platform` and `platformChatId` as positional arguments (not pagination or filtering), and `listConversations` takes `platform` (optional filter) and `limit` but not `before`.
- **Evidence**: In `types.ts` lines 118-121:
  ```typescript
  getConversation(
    platform: Platform,
    platformChatId: string,
  ): Conversation | null;
  ```
  And `listConversations` (lines 113-116) takes `platform?` and `limit?` but no `before` cursor.

### 16. Missing: No mention of the InboundMessage import in store.ts

- **Category**: Clarification
- **Location**: architecture.md, "Layered Design" section
- **Issue**: The docs state "Each layer only depends on the one below it." However, `store.ts` imports `InboundMessage` from `types.ts` (line 8), even though it does not actually use it anywhere in the file. This is a dead import but does not violate the layered architecture claim (types are at the bottom). It is a minor code quality observation.
- **Evidence**: In `store.ts` line 8: `import type { Platform, TimelineEntry, Conversation, InboundMessage } from "../types"`. The `InboundMessage` type is never used in the store.

### 17. Missing: recordResponse platformChatType is always null

- **Category**: Missing
- **Location**: implementation.md, "recordResponse" section
- **Issue**: The docs don't mention that outbound responses always set `platformChatType` to `null`. This means that if a response is the first message to a new conversation, the conversation's `platformChatType` will be `null`. Furthermore, because the upsert only updates `platformChatType` when the new value is non-null, subsequent outbound responses will never overwrite an existing platformChatType.
- **Evidence**: In `service.ts` line 71: `platformChatType: null`.

### 18. Missing: Error response format

- **Category**: Missing
- **Location**: implementation.md, "Error Handling" section
- **Issue**: The docs describe the status codes but not the exact response body shape for errors. The 400 and 404 responses return `{ error: string }`. The 500 response returns `{ error: "Internal server error" }`.
- **Evidence**: In `router.ts` line 17: `res.status(400).json({ error: err.message })`. In `router.ts` line 80: `res.status(404).json({ error: "Conversation not found" })`. In `server.ts` line 21: `res.status(500).json({ error: "Internal server error" })`.

### 19. Clarification: "ordered by most recent activity" for conversations

- **Category**: Clarification
- **Location**: implementation.md, "GET /api/conversations" section
- **Issue**: The docs say conversations are "ordered by most recent activity." The code orders by `lastMessageAt` descending. These are equivalent, but the docs could be more precise that "activity" means the `lastMessageAt` timestamp, not (for example) the time of the most recent API query.
- **Evidence**: In `store.ts` lines 205-209:
  ```typescript
  convos.sort(
    (a, b) =>
      new Date(b.lastMessageAt).getTime() -
      new Date(a.lastMessageAt).getTime(),
  );
  ```

### 20. Missing: The text field is optional for inbound messages

- **Category**: Clarification
- **Location**: implementation.md, "POST /api/messages" section
- **Issue**: The docs list `text` as an optional field for POST /api/messages, which is correct. However, the validation section says "Validates that all required fields are present and non-empty" without clarifying that `text` is specifically excluded from validation. A message with no text (e.g., a photo or sticker in Telegram) is valid.
- **Evidence**: In `service.ts` lines 136-155, the `validateInbound` method checks platform, platformMessageId, platformChatId, senderName, senderId, and timestamp -- but not text. In `types.ts` line 24: `text?: string`.

---

## Summary

| Category | Count |
|---|---|
| Contradiction | 0 |
| Inaccuracy | 3 |
| Missing | 10 |
| Ambiguity | 2 |
| Clarification | 5 |
| **Total** | **20** |

The documentation is broadly accurate and well-structured. No outright contradictions were found. The most significant findings are:

1. **The listConversations default limit is wrong** (docs say 20, code says 50) -- Finding #2.
2. **recordResponse also upserts conversations** (not documented, has side effects like overwriting the label to "System") -- Findings #3 and #5.
3. **ingestTransaction is not truly atomic** (two separate persist calls) -- Finding #6.
4. **The Conversation model's platformChatType field is undocumented** -- Finding #7.
5. **Query method descriptions are overgeneralized** (not all accept the same parameters) -- Finding #15.
