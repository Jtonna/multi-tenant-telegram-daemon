# Chat Router Plugin (Telegram): Implementation Details

For the architectural context behind these implementation details -- design patterns, process boundaries, data flow diagrams, and configuration modes -- see [Architecture](architecture.md).

## Bot Creation

The bot is created by a factory function `createBot(token: string, chatRouter?: ChatRouterClient, accessConfig?: BotAccessConfig): Bot` in `bot.ts`. The function creates a grammY `Bot` instance, registers the `/start` and `/config` command handlers, installs the access control guard middleware, registers the main message handler, and returns the configured bot without starting it.

The optional `ChatRouterClient` parameter implements the Optional Dependency Injection pattern described in [Architecture](architecture.md#design-patterns). When present, the message handler forwards messages; when absent, it skips forwarding entirely. The bot creation and handler logic are identical in both modes -- the only difference is whether the `chatRouter` variable is defined.

The optional `accessConfig` parameter enables access control enforcement. When undefined, the bot allows all messages (backwards compatible). When provided, the guard middleware uses it to enforce the allowlist. See [Access Control](#access-control) for details.

The caller (`index.ts`) is responsible for calling `bot.start()` separately, keeping the factory function free of lifecycle concerns.

## Command Handlers

The bot registers two command handlers:

**`/start` command**: Sends a static welcome message:

> Hello! I'm the multi-tenant Telegram daemon bot.
> Send me any message and it will be forwarded to the chat router.
>
> This is a Phase 1 test bot for exploring the Telegram API.

**`/config` command**: Returns the user's Telegram user ID and (if applicable) the group chat ID. This command helps users discover the IDs needed for the access control allowlists. Example output:

> Your Telegram user ID: 123456789
> Group chat ID: -1001234567890
> Chat type: supergroup
>
> Give these IDs to the bot admin to get allowlisted.

The `/config` command always responds, even if the user is not in the allowlist. This is intentional -- it allows new users to discover their ID before requesting access. The access control guard runs after command handlers, so commands bypass the allowlist check.

## Access Control

The bot implements access control through three components: the `BotAccessConfig` interface, the `checkAccess()` pure function, and a guard middleware. All three are defined in `bot.ts`.

### BotAccessConfig Interface

```typescript
export interface BotAccessConfig {
  allowedUserIds: Set<number>;
  allowedGroupIds: Set<number>;
}
```

This configuration is constructed in `index.ts` by parsing the `TELEGRAM_ALLOWED_USER_IDS` and `TELEGRAM_ALLOWED_GROUP_IDS` environment variables. The parsing logic splits on commas, trims whitespace, filters empty strings, converts to numbers, and filters out NaN values. The resulting sets are passed to `createBot()` as the optional third parameter.

### checkAccess() Function

```typescript
export function checkAccess(
  chatType: string,
  userId: number,
  chatId: number,
  config?: BotAccessConfig
): boolean
```

This is a pure function with no side effects. It returns `true` if access is allowed, `false` otherwise. The logic:

- If `config` is undefined, return `true` (allow all -- backwards compatible).
- If `chatType` is `"private"`, check if `userId` is in `config.allowedUserIds`.
- If `chatType` is `"group"` or `"supergroup"`, check if `chatId` is in `config.allowedGroupIds`.
- For all other chat types (channels, unknown), return `false`.

### Guard Middleware

The guard middleware is registered via `bot.use()` before the message handler. It extracts `chatType`, `userId`, and `chatId` from the incoming context, calls `checkAccess()`, and either continues to the next handler (`next()`) or silently drops the message (returns without calling `next()`).

When a message is dropped, the middleware logs:

```
[ACCESS DENIED] chatType=<type> userId=<id> chatId=<id>
```

The middleware skips access checks for non-message updates (e.g., callback queries, inline queries) by returning early if `chatType`, `userId`, or `chatId` are undefined.

**Important**: Command handlers run before the guard middleware, so `/start` and `/config` commands are always processed, even from unlisted users. This allows new users to discover their IDs via `/config` before requesting access.

## Message Handler

When a message arrives, the handler (registered via `bot.on("message", ...)`) executes two steps in order:

**Step 1 -- Logging**: The handler extracts key fields from the message and logs them to the console in a human-readable aligned format:

- Wall-clock timestamp (`new Date().toISOString()`)
- Message ID (`msg.message_id`)
- Chat ID (`msg.chat.id`)
- Chat type (`msg.chat.type`)
- Sender info (`msg.from` as formatted JSON)
- Message timestamp (`msg.date`, converted to ISO string via `new Date(msg.date * 1000)`)
- Text content (`msg.text`, or `"(no text)"` if absent)

The full raw message object is also logged as formatted JSON for exploration purposes. This logging is always active regardless of operating mode.

**Step 2 -- Forwarding and Reaction**: If a `ChatRouterClient` was provided to the factory function, the handler calls `mapTelegramToInbound(ctx)` to convert the grammY Context into an `InboundMessage`, then calls `chatRouter.ingestMessage(inbound)` to send it to the chat router's REST API. If ingestion succeeds, the handler reacts to the original message with a thumbs-up emoji (`ctx.react("👍")`) to provide visual feedback that the message was received and the agent job was triggered. This entire operation is wrapped in a try-catch: if the fetch or the mapper throws, the error is logged to `console.error` and no reaction is sent. Forwarding runs for all message types regardless of whether text is present.

## The ChatRouterClient

The `ChatRouterClient` class in `chatRouterClient.ts` wraps Node.js native `fetch` behind a domain-specific interface. It is constructed with a base URL (e.g., `http://localhost:3100`) and strips trailing slashes during construction using `baseUrl.replace(/\/+$/, "")` to prevent double-slash issues in endpoint paths.

The class provides two methods:

**`ingestMessage(msg: InboundMessage): Promise<unknown>`** -- Sends a POST request to `/api/messages` with the `InboundMessage` as the JSON body (Content-Type: `application/json`). On success, it returns the parsed JSON response via `res.json()`. If the response status is not OK, it reads the response body text and throws an `Error` with the message `Chat router returned ${res.status}: ${body}`.

**`healthCheck(): Promise<{ ok: boolean }>`** -- Sends a GET request to `/api/health`. On success, it returns the parsed JSON response cast as `{ ok: boolean }`. If the response status is not OK, it throws an `Error` with the message `Chat router health check failed: ${res.status}` (status code only, no response body). This method is available for diagnostic purposes but is not currently called by the bot's message flow.

## The ChatRouterWsClient

The `ChatRouterWsClient` class in `wsClient.ts` manages the bidirectional WebSocket connection to the chat router's `/ws` endpoint for receiving outbound messages. It is constructed with a base URL (e.g., `http://localhost:3100`), a grammY `Bot` instance (for sending messages), and an optional reconnect delay (defaults to 3000ms).

**Connection lifecycle:**
- On `connect()`, the client converts the base URL to WebSocket protocol (`http://` → `ws://`, `https://` → `wss://`) and establishes a connection to `/ws`.
- On successful connection, the client logs `"WebSocket connected to chat router"` and listens for message events.
- On disconnect or error, the client logs the event and schedules a reconnect attempt after the configured delay.
- On `disconnect()`, the client closes the WebSocket cleanly and clears any pending reconnect timers.

**Message filtering and delivery:**
- When a message event arrives, the client parses the JSON payload and checks three conditions:
  - `direction === "out"` (outbound message from chat router)
  - `platform === "telegram"` (intended for this plugin)
  - `text != null` (message has text content)
- If all conditions pass, the client calls `splitMessage(text)` to handle Telegram's 4096-character limit, then sends each chunk via `bot.api.sendMessage(platformChatId, chunk)`.
- Delivery errors are logged via `console.error` but do not disconnect the WebSocket or halt processing of subsequent messages.

**Dependencies:**
- The client uses the `ws` library (WebSocket protocol implementation) and `@types/ws` for type definitions.
- It imports `splitMessage` from `splitMessage.ts` for message chunking.
- It requires a grammY `Bot` instance to access the Telegram API via `bot.api.sendMessage()`.

The WebSocket client is created and started in `index.ts` when `CHAT_ROUTER_URL` is set, and is stopped during graceful shutdown alongside the bot instance.

## The Mapper Function

The `mapTelegramToInbound(ctx: Context): InboundMessage` function in `chatRouterClient.ts` converts a grammY Context into the chat router's normalized message format. For the conceptual purpose and categories of transformation, see [The Mapper Pattern](architecture.md#the-mapper-pattern).

The `InboundMessage` interface is redeclared locally in `chatRouterClient.ts` rather than imported from the chat-router package, since the two are separate processes with no shared dependencies. The two declarations are kept in sync by convention and validated by the mapper tests. The local interface has the `platform` field typed as the string literal `"telegram"` (not a generic `string`), making it specific to this plugin. The optional fields `platformChatType`, `text`, and `platformMeta` are all marked with `?` in the interface, though the mapper always populates them.

The mapper uses non-null assertions (`msg.from!`) to access the sender object. This means it will throw a TypeError if `from` is undefined, which can happen for channel posts. This is an intentional simplification for Phase 1, where only direct user messages are expected.

Field-by-field transformations:

- **platform** -- Hardcoded to `"telegram"`.
- **platformMessageId** -- `String(msg.message_id)`. Converts the numeric message ID to a string.
- **platformChatId** -- `String(msg.chat.id)`. Converts the numeric chat ID to a string. Telegram chat IDs can be negative (e.g., for supergroups), and the sign is preserved.
- **platformChatType** -- `msg.chat.type` passed through directly. Possible values: `"private"`, `"group"`, `"supergroup"`, or `"channel"`.
- **senderName** -- `[from.first_name, from.last_name].filter(Boolean).join(" ")`. Concatenates first and last name with a space. If `last_name` is absent/undefined, `filter(Boolean)` removes it and only `first_name` is used.
- **senderId** -- `String(from.id)`. Converts the numeric user ID to a string.
- **text** -- `msg.text` passed through as-is. May be `undefined` for non-text messages.
- **timestamp** -- `msg.date * 1000`. Converts Unix seconds (Telegram's format) to Unix milliseconds (chat router's format).
- **platformMeta** -- An object with three Telegram-specific fields:
  - `chatTitle`: extracted via `"title" in msg.chat ? msg.chat.title : undefined` (the group/channel title, if applicable; `undefined` for private chats).
  - `fromUsername`: `from.username` (the sender's @username; may be `undefined`).
  - `fromIsBot`: `from.is_bot` (boolean indicating whether the sender is a bot).

The mapper function is colocated with the `ChatRouterClient` class in the same file (`chatRouterClient.ts`). Both are exported and imported together by the bot module.

## The splitMessage Utility

The `splitMessage(text: string, maxLength: number = 4096): string[]` function in `splitMessage.ts` breaks long messages into chunks that fit within Telegram's message size limit. For the architectural motivation, see [Message Splitting](architecture.md#message-splitting).

The algorithm:

1. If the text is empty, return `[""]` (a single-element array containing the empty string).
2. If the text length is within `maxLength`, return the text as a single-element array.
3. Otherwise, enter a loop over the remaining text:
   a. If the remaining text fits within `maxLength`, push it and break.
   b. Take the first `maxLength` characters as a window and find the last newline (`lastIndexOf("\n")`).
   c. If a newline is found at index > 0, split there at `lastNewline + 1` (the newline character is included in the current chunk, not the next).
   d. If no newline is found within the window, or if the only newline is at index 0, hard-split at exactly `maxLength`.
   e. Push the chunk, slice the remainder, and repeat.

The function accepts an optional `maxLength` parameter that overrides the 4096 default. This is used by tests to verify the algorithm with smaller values. The utility guarantees that joining all returned chunks produces the original text with no characters lost or added.

## Error Handling

The plugin is designed for graceful degradation at every level:

- **Missing BOT_TOKEN**: The process exits immediately with a clear error message to `console.error`, including instructions to create a `.env` file. Exit code is 1.
- **Missing CHAT_ROUTER_URL**: The plugin logs `"CHAT_ROUTER_URL not set -- running in standalone mode (echo only)"` and continues without forwarding. This is normal operation, not an error.
- **Chat router unreachable or returning an error**: The try-catch in the message handler catches the error, logs it via `console.error("  -> Failed to forward to chat-router:", err)`, and skips the thumbs-up reaction. The bot remains fully operational.
- **Telegram API failure**: When sending a reply fails, grammY's internal error handling manages the failure.
- **Graceful shutdown**: The composition root (`index.ts`) registers listeners for `SIGINT` and `SIGTERM` signals. Both call `bot.stop()` to cleanly disconnect from Telegram's long polling.

## Testing Approach

All tests use vitest. No tests require a running Telegram bot, chat router, or network access.

- **Bot tests** (`bot.test.ts`, 7 tests) -- Verify that `createBot` returns a valid `Bot` instance with expected methods (`on`, `start`, `stop`), that handlers are registered (the bot is defined after creation), and that an empty string token throws an error. Also test the `checkAccess()` function: allow-all when config is undefined, allow DM when user is in allowlist, deny DM when user is not in allowlist, allow group when group is in allowlist, deny group when group is not in allowlist, deny channels always, deny unknown chat types.
- **Mapper tests** (`chatRouterClient.test.ts`, 10 tests) -- Test `mapTelegramToInbound` with mocked grammY Context objects. Verify: platform is `"telegram"`, `platformMessageId` is a string, `platformChatId` is a string (including negative IDs), timestamp is converted to milliseconds, `senderName` concatenates first and last name, missing `last_name` is handled gracefully, `platformChatType` passes through from `chat.type`, `platformMeta` contains `chatTitle`/`fromUsername`/`fromIsBot`, `senderId` is a string, and `text` is preserved. Note: the `ChatRouterClient` HTTP class itself is not currently tested; only the mapper function has coverage.
- **splitMessage tests** (`splitMessage.test.ts`, 9 tests) -- Cover: short messages (single-element return), messages exactly at the 4096 limit, empty strings, splitting at newline boundaries (with small `maxLength`), hard splitting with no newlines, preferring newline over hard split, messages just over the limit, multiple newlines, and the default 4096 limit.

Total: 26 tests across 3 test files.
