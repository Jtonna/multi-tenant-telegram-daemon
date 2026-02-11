# Chat Router Plugin (Telegram): Implementation Details

## Bot Creation

The bot is created by a factory function called createBot that accepts a Telegram bot token and an optional ChatRouterClient instance. The function creates a grammY Bot, registers the /start command handler and the main message handler, and returns the configured bot without starting it.

The optional ChatRouterClient parameter is what makes standalone vs connected mode possible. When present, the message handler forwards messages; when absent, it skips forwarding entirely. This design means the bot creation and handler logic are identical in both modes.

## Message Handler

When a message arrives, the handler executes three steps in order:

**Logging**: The handler extracts key fields from the message (wall-clock timestamp, message ID, chat ID, chat type, sender information, message timestamp, text content) and logs them to the console in a human-readable aligned format. The full raw message object is also logged as formatted JSON for exploration purposes. This logging is always active regardless of mode.

**Forwarding**: If a ChatRouterClient was provided, the handler calls the mapper to convert the Telegram message to an InboundMessage, then sends it to the chat router's REST API. This entire operation is wrapped in a try-catch -- if it fails, the error is logged and processing continues. The handler does not await a meaningful response from the chat router; it only checks that the request succeeded.

**Echo**: If the message contains text, the handler splits it into chunks (if necessary) and sends each chunk back as a reply. This provides immediate visual feedback during development and testing.

## Command Handlers

The only command handler is /start, which sends a static welcome message identifying the bot and explaining that it echoes messages. No other commands are registered.

## The ChatRouterClient

The HTTP client is a class that wraps Node.js native fetch. It is constructed with a base URL (e.g., http://localhost:3100) and provides two methods:

**ingestMessage** sends a POST request to /api/messages with the InboundMessage as the JSON body. On success, it returns the parsed JSON response. It throws an error if the response status is not OK, including the status code and response body text in the error message.

**healthCheck** sends a GET request to /api/health. On success, it returns the parsed JSON response. It throws an error if the response status is not OK, including the status code (but not the response body) in the error message. This is available for diagnostic purposes but is not currently called by the bot's message flow.

The client strips trailing slashes from the base URL during construction to prevent double-slash issues in endpoint paths.

## The Mapper Function

The mapTelegramToInbound function accepts a grammY Context and returns an InboundMessage. The InboundMessage interface is redeclared locally in the plugin (in chatRouterClient.ts) rather than imported from the chat-router package, since the two are separate processes with no shared dependencies. The two declarations are kept in sync by convention and validated by the mapper tests.

The local InboundMessage has the platform field typed as the string literal `"telegram"` (not a generic `string`), making the interface specific to this plugin. The optional fields platformChatType, text, and platformMeta are all marked with `?` in the interface, though the mapper always populates them.

The mapper uses non-null assertions (`msg.from!`) to access the sender object, meaning it will throw a TypeError if `from` is undefined (which can happen for channel posts). This is an intentional simplification for Phase 1, where only direct user messages are expected.

It performs these field-by-field transformations:

- **platform** is hardcoded to "telegram".
- **platformMessageId** converts message_id (a number in Telegram) to a string.
- **platformChatId** converts chat.id (a number) to a string. This is important because Telegram chat IDs can be negative (e.g., for supergroups).
- **platformChatType** passes through the chat.type string directly ("private", "group", "supergroup", or "channel").
- **senderName** concatenates from.first_name and from.last_name with a space, filtering out undefined values. If last_name is absent, only first_name is used.
- **senderId** converts from.id (a number) to a string.
- **text** passes through msg.text as-is (may be undefined for non-text messages).
- **timestamp** multiplies msg.date by 1000 to convert from Unix seconds to Unix milliseconds.
- **platformMeta** is populated with three Telegram-specific fields: chatTitle (the group/channel title if applicable), fromUsername (the sender's @username), and fromIsBot (whether the sender is a bot).

The mapper function is colocated with the ChatRouterClient class in the same file (chatRouterClient.ts). Both are exported and imported together by the bot module.

## The splitMessage Utility

The splitting algorithm is designed to produce readable chunks by preferring to break at line boundaries:

1. If the text is within the 4096-character limit, it is returned as a single-element array.
2. If it exceeds the limit, the algorithm looks at the first 4096 characters and finds the last newline character within that window.
3. If a newline is found at index > 0, it splits there (including the newline in the current chunk) and repeats on the remainder. Note: a newline at index 0 is treated as "no newline found" and falls through to the hard split.
4. If no suitable newline is found in the window, it hard-splits at exactly 4096 characters and repeats.
5. The function accepts an optional maxLength parameter that overrides the 4096 default, which is used by tests to verify the algorithm with smaller values.

The utility guarantees that joining all returned chunks produces the original text with no characters lost or added.

## Error Handling

The plugin is designed for graceful degradation:

- If BOT_TOKEN is not set, the process exits immediately with a clear error message.
- If CHAT_ROUTER_URL is not set, the plugin logs that it is running in standalone mode and continues without forwarding.
- If the chat router is unreachable or returns an error, the forwarding failure is logged but does not prevent the echo response.
- If the Telegram API itself fails (e.g., when sending a reply), grammY's internal error handling manages the failure.

The graceful shutdown handler listens for SIGINT and SIGTERM signals, calling bot.stop() to cleanly disconnect from Telegram's long polling.

## Testing Approach

All tests use vitest. No tests require a running Telegram bot, chat router, or network access.

- **Bot tests** (3 tests) -- Verify that createBot returns a valid Bot instance with expected methods, that handlers are registered, and that an empty token throws an error.
- **splitMessage tests** (9 tests) -- Cover short messages, messages exactly at the limit, empty strings, splitting at newline boundaries, hard splitting with no newlines, preferring newline over hard split, messages just over the limit, multiple newlines, and the default 4096 limit.
- **Mapper tests** (10 tests, in chatRouterClient.test.ts) -- Test the mapTelegramToInbound function with mocked grammY Context objects. Verify that numeric IDs become strings, timestamps are converted to milliseconds, first and last names are concatenated properly, missing last names are handled, platform is set to "telegram", platformMeta contains the expected fields, and chat type is passed through correctly. Note: the ChatRouterClient HTTP class itself is not currently tested; only the mapper function has coverage.

Total: 22 tests across 3 test files.
