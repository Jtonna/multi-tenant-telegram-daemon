# Chat Router Plugin Documentation Audit

**Date**: 2026-02-10
**Scope**: All three docs in `docs/chat-router-plugin/` audited against source code in `telegram-integration/src/`.

---

## Finding 1

- **Category**: Inaccuracy
- **Location**: `architecture.md`, section "Message Flow", step 2
- **Issue**: The docs say the handler logs "message ID, chat ID, chat type, sender info, timestamp, text". The actual code also logs a current wall-clock timestamp via `new Date().toISOString()` as the first logged field (labeled "Timestamp"), which is distinct from the message's own `date` field that is also logged. The docs do not mention this extra wall-clock timestamp.
- **Evidence**: In `bot.ts` lines 31-37, the handler logs `new Date().toISOString()` (current time) as the very first field, then separately logs the message's `date` field converted to ISO. The docs only mention the message timestamp, not the wall-clock timestamp.

---

## Finding 2

- **Category**: Inaccuracy
- **Location**: `implementation.md`, section "The ChatRouterClient"
- **Issue**: The docs say `ingestMessage` "throws an error if the response status is not OK, including the status code and response body in the error message." The method signature returns `Promise<unknown>` and, on success, calls `res.json()` and returns the parsed JSON. The docs do not mention that the method returns the parsed JSON response body on success, only that it throws on failure.
- **Evidence**: In `chatRouterClient.ts` line 68, on the success path: `return res.json();`. The docs describe only the error behavior.

---

## Finding 3

- **Category**: Inaccuracy
- **Location**: `implementation.md`, section "The ChatRouterClient"
- **Issue**: The docs say the client "provides two methods" and describe `healthCheck` as returning "the parsed JSON response". The actual `healthCheck` method also throws an error on non-OK responses, mirroring `ingestMessage`, but the error message format is different -- it only includes the status code, not the response body. The docs do not mention this throw behavior for `healthCheck`.
- **Evidence**: In `chatRouterClient.ts` lines 74-76: `if (!res.ok) { throw new Error(\`Chat router health check failed: ${res.status}\`); }` -- throws on failure but without the response body text (unlike `ingestMessage` which includes the body).

---

## Finding 4

- **Category**: Contradiction
- **Location**: `architecture.md`, section "Message Flow", step 4
- **Issue**: The docs state "If the message has no text, no echo is sent but the forward still occurs." This is accurate for the forwarding behavior, but the wording "the forward still occurs" could be read as implying the forwarding is contingent on text being present earlier in the flow. In reality, forwarding happens (step 3) before the text check (step 4), and forwarding is performed for ALL message types regardless of whether text is present. The statement is technically correct but the phrasing "still occurs" implies it is noteworthy that it continues, when in fact the forwarding never depended on text in the first place.
- **Evidence**: In `bot.ts` lines 45-53, the forwarding block has no text check -- it runs unconditionally (if chatRouter is configured). The text check only appears at line 56 for the echo step.

---

## Finding 5

- **Category**: Ambiguity
- **Location**: `implementation.md`, section "The Mapper Function"
- **Issue**: The docs say "senderName concatenates from.first_name and from.last_name with a space, filtering out undefined values. If both are somehow absent, the result would be an empty string." In the actual code, the mapper uses `msg.from!` (non-null assertion), meaning it assumes `from` is always present. If `from` is undefined (which can happen for channel posts), the code would crash with a runtime error, not produce an empty string. The "both absent" scenario described in the docs would actually crash.
- **Evidence**: In `chatRouterClient.ts` line 25: `const from = msg.from!;` -- this non-null assertion means the code will throw a TypeError if `from` is undefined. The `.filter(Boolean).join(" ")` only handles missing `first_name`/`last_name` on an existing `from` object.

---

## Finding 6

- **Category**: Missing
- **Location**: All three docs
- **Issue**: The `InboundMessage` interface is locally redeclared in the plugin (with a comment "redeclared locally (no cross-package import)"). This is an important architectural decision -- the plugin does not import from the chat-router package, it duplicates the type. None of the docs mention this local redeclaration pattern or why it exists.
- **Evidence**: In `chatRouterClient.ts` lines 6-17, the `InboundMessage` interface is declared locally with the comment `// InboundMessage -- redeclared locally (no cross-package import)`. The architecture doc mentions "no in-process imports between the two packages" but does not explain that the type is duplicated.

---

## Finding 7

- **Category**: Missing
- **Location**: `implementation.md`, section "The Mapper Function"
- **Issue**: The docs do not mention that several fields in the `InboundMessage` interface are optional (`platformChatType`, `text`, `platformMeta` are all marked with `?`). The mapper always populates all of them, but the interface permits omitting them.
- **Evidence**: In `chatRouterClient.ts` lines 11, 14, and 16: `platformChatType?: string;`, `text?: string;`, `platformMeta?: Record<string, unknown>;` are all optional.

---

## Finding 8

- **Category**: Clarification
- **Location**: `implementation.md`, section "The splitMessage Utility", point 3
- **Issue**: The docs say "If a newline is found, it splits there (including the newline in the first chunk)." The code actually checks `lastNewline > 0` (strictly greater than zero), not `lastNewline >= 0`. This means if a newline is found at index 0 (the very first character), the code treats it the same as "no newline found" and performs a hard split at maxLength instead of splitting at the newline. This edge case is not documented.
- **Evidence**: In `splitMessage.ts` line 47: `if (lastNewline > 0)` -- a newline at position 0 would have `lastNewline === 0`, which fails this condition and falls through to the hard-split branch.

---

## Finding 9

- **Category**: Missing
- **Location**: `index.md`, section "Dependencies"
- **Issue**: The docs list runtime dependencies as "grammY" and "dotenv" and say "No HTTP client library needed -- uses Node.js native fetch." The dev dependencies (typescript, tsx, vitest, @types/node) are not mentioned anywhere. While this is arguably acceptable for user-facing docs, the dev toolchain is relevant for contributors.
- **Evidence**: In `package.json` lines 22-27: `"devDependencies": { "typescript": "^5.7.3", "tsx": "^4.19.2", "vitest": "^3.0.5", "@types/node": "^22.12.0" }`.

---

## Finding 10

- **Category**: Missing
- **Location**: `index.md` and `implementation.md`
- **Issue**: The docs do not mention the `test:watch` script available in `package.json`. Only `npm test` is documented. The `test:watch` script (`vitest` without `run`) starts vitest in watch mode, which is useful for development.
- **Evidence**: In `package.json` line 11: `"test:watch": "vitest"`.

---

## Finding 11

- **Category**: Clarification
- **Location**: `implementation.md`, section "Bot Creation"
- **Issue**: The docs say createBot "returns the configured bot without starting it." While accurate, it does not mention that the bot is started separately in `index.ts` via `bot.start()` with an `onStart` callback that logs the bot's username, ID, and name. This startup behavior (including what gets logged) is not documented anywhere.
- **Evidence**: In `index.ts` lines 38-45: `bot.start({ onStart: (botInfo) => { console.log(\`Bot started successfully!\`); console.log(\`  Username: @${botInfo.username}\`); ... } });`.

---

## Finding 12

- **Category**: Clarification
- **Location**: `architecture.md`, section "Message Flow", step 2
- **Issue**: The docs say the handler logs message details "in a structured format." The actual log format uses console.log with manually aligned labels and colons (e.g., "Message ID:", "Chat ID   :"). This is not a structured format in the conventional sense (JSON, key-value pairs, etc.) -- it is a human-readable aligned format. Calling it "structured" could mislead readers expecting machine-parseable output.
- **Evidence**: In `bot.ts` lines 30-42, the logging uses manually padded labels like `"Timestamp :"`, `"Message ID:"`, `"Chat ID   :"` with `console.log`. The full raw message is logged as formatted JSON, but the overall output is not structured logging.

---

## Finding 13

- **Category**: Missing
- **Location**: `implementation.md`, section "Testing Approach"
- **Issue**: The chatRouterClient test file only tests the `mapTelegramToInbound` function. It does not test the `ChatRouterClient` class itself (no tests for `ingestMessage`, `healthCheck`, trailing-slash stripping, or error throwing). The docs describe these as "chatRouterClient tests" which could imply the class is tested. The doc does clarify that the tests "Test the mapTelegramToInbound function with mocked grammY Context objects" but the heading "chatRouterClient tests" is misleading since the HTTP client class has zero test coverage.
- **Evidence**: In `chatRouterClient.test.ts`, only `mapTelegramToInbound` is imported (line 2) and all 10 tests are `describe("mapTelegramToInbound", ...)`. The `ChatRouterClient` class is never imported or tested.

---

## Finding 14

- **Category**: Inaccuracy
- **Location**: `architecture.md`, section "The Mapper Pattern"
- **Issue**: The docs say "The mapper lives in the plugin, not in the chat router." This is true, but the mapper function is exported from the same file (`chatRouterClient.ts`) as the `ChatRouterClient` class. The docs do not mention this colocation. A reader might expect the mapper to be in its own module given its conceptual importance as described in the architecture doc.
- **Evidence**: In `chatRouterClient.ts`, both `mapTelegramToInbound` (line 23) and `ChatRouterClient` (line 48) are exported from the same file. The bot imports both from the same module: `import { ChatRouterClient, mapTelegramToInbound } from "./chatRouterClient";` (bot.ts line 3).

---

## Finding 15

- **Category**: Missing
- **Location**: `index.md`, section "How to Run"
- **Issue**: The docs mention `npm run dev` for development and `npm run build && npm start` for production, but do not mention that `dev` uses `tsx watch` (which provides automatic reload on file changes). This is a useful detail for developers.
- **Evidence**: In `package.json` line 7: `"dev": "tsx watch src/index.ts"`.

---

## Finding 16

- **Category**: Clarification
- **Location**: `implementation.md`, section "Error Handling"
- **Issue**: The docs say "The graceful shutdown handler listens for SIGINT and SIGTERM signals, calling bot.stop() to cleanly disconnect from Telegram's long polling." The actual code defines a `shutdown` function that logs which signal was received before calling `bot.stop()`. This logging detail is not mentioned.
- **Evidence**: In `index.ts` lines 26-29: `function shutdown(signal: string) { console.log(\`\\nReceived ${signal}. Stopping bot...\`); bot.stop(); }`.

---

## Finding 17

- **Category**: Clarification
- **Location**: `architecture.md`, section "Message Splitting"
- **Issue**: The docs say "If it exceeds the limit, the utility looks for the last newline character within the allowed length and splits there, preserving readability." It then says "If no newline is found within the window, it hard-splits at the maximum length." The phrase "within the window" could be more precisely stated as "within the first maxLength characters of the remaining text." The "window" terminology is consistent with the code variable name but may not be immediately clear to readers.
- **Evidence**: In `splitMessage.ts` line 43: `const window = remaining.slice(0, maxLength);` -- the variable is literally named `window` but the docs do not clarify its exact boundaries.

---

## Finding 18

- **Category**: Ambiguity
- **Location**: `implementation.md`, section "Message Handler"
- **Issue**: The docs describe three steps "in order": Logging, Forwarding, Echo. The forwarding step is described as wrapped in try-catch, but the docs do not mention that forwarding uses `await` (making it truly sequential). This matters because the echo step does not begin until forwarding either completes or fails. The docs say "Steps 3 and 4 are independent" (in architecture.md) which is true in terms of failure isolation, but they are sequential in execution. This could mislead readers into thinking they run in parallel.
- **Evidence**: In `bot.ts` line 48: `await chatRouter.ingestMessage(inbound);` -- the echo at lines 57-60 does not execute until this await resolves or the catch block completes. The architecture doc (line 35) says "Steps 3 and 4 are independent" which refers to failure independence, not execution independence.

---

## Finding 19

- **Category**: Missing
- **Location**: All three docs
- **Issue**: The `InboundMessage` interface has the `platform` field typed as the literal string `"telegram"` (not `string`). This is a type-level constraint worth documenting, as it means the interface is specifically for the Telegram plugin and would need to be generalized (or a union type used) for other plugins.
- **Evidence**: In `chatRouterClient.ts` line 8: `platform: "telegram";` -- a string literal type, not a generic `string`.

---

## Finding 20

- **Category**: Missing
- **Location**: `index.md` and `implementation.md`
- **Issue**: The startup sequence in `index.ts` logs two informational messages before calling `bot.start()`: "Starting Telegram bot with long polling..." and "Waiting for messages -- send a message to your bot on Telegram." These startup log messages are not documented.
- **Evidence**: In `index.ts` lines 35-36: `console.log("Starting Telegram bot with long polling...");` and `console.log("Waiting for messages -- send a message to your bot on Telegram.\n");`.

---

## Summary

| Category | Count |
|---|---|
| Contradiction | 1 |
| Inaccuracy | 3 |
| Missing | 7 |
| Ambiguity | 2 |
| Clarification | 5 |
| **Total** | **18** |

*Note: Finding 4 is classified as Contradiction but is borderline Ambiguity. Finding 14 is classified as Inaccuracy but is borderline Clarification. Reasonable auditors may categorize differently.*
