# Chat Router Plugin (Telegram): Architecture

## Plugin as a Separate Process

The Telegram plugin runs as its own Node.js process, completely independent of the chat router. This separation is intentional:

- The plugin can be started, stopped, and restarted without affecting the chat router or other plugins.
- The plugin only needs to know the chat router's HTTP URL, not its internal implementation.
- Multiple plugins (Telegram, Discord, Slack) can run simultaneously, each in its own process, all feeding into the same chat router.
- If a plugin crashes, the chat router and other plugins continue operating.

The plugin communicates with the chat router exclusively through its REST API. There are no shared dependencies, no shared database, and no in-process imports between the two packages.

## The grammY Bot

The plugin uses grammY, a Telegram Bot API framework for Node.js. It connects to Telegram using long polling, which means the bot continuously asks Telegram's servers for new messages. This approach requires no inbound network configuration (no webhook URL, no SSL certificate, no public-facing server).

The bot registers two handlers:

- A command handler for /start that sends a welcome message.
- A message handler that processes every incoming message: logs it, optionally forwards it to the chat router, and echoes the text back.

The message handler runs for all message types, but only text messages are forwarded and echoed. Non-text messages (photos, stickers, etc.) are logged but otherwise ignored in the current implementation.

## Message Flow

When a user sends a message to the Telegram bot:

1. grammY receives the message via long polling and invokes the message handler with a Context object.
2. The handler logs the message details to the console (message ID, chat ID, chat type, sender info, timestamp, text).
3. If a ChatRouterClient is configured, the handler calls mapTelegramToInbound to convert the grammY Context into the chat router's normalized InboundMessage format, then sends it to the chat router via HTTP POST.
4. If the message contains text, the handler splits it if necessary (for messages over 4096 characters) and echoes each chunk back as a Telegram reply.

Steps 3 and 4 are independent. If the chat router is down or the forwarding fails, the echo still happens. If the message has no text, no echo is sent but the forward still occurs.

## The Mapper Pattern

The mapper function (mapTelegramToInbound) is the critical translation layer between Telegram's data model and the chat router's normalized format. It handles several key conversions:

**ID normalization**: Telegram uses numeric IDs for messages, chats, and users. The chat router expects string IDs (to accommodate platforms like Discord that use non-numeric snowflake IDs). The mapper converts all numeric IDs to strings.

**Timestamp conversion**: Telegram provides timestamps as Unix seconds. The chat router expects Unix milliseconds. The mapper multiplies by 1000.

**Name construction**: Telegram provides first_name and optional last_name as separate fields. The mapper concatenates them with a space, filtering out undefined values.

**Platform metadata**: The mapper extracts Telegram-specific fields that might be useful later (chat title for groups, sender username, whether the sender is a bot) and packages them into the platformMeta bag. The chat router stores this as opaque JSON without interpreting it.

The mapper lives in the plugin, not in the chat router. Each plugin is responsible for mapping its own platform's data into the normalized format. The chat router never imports platform-specific types.

## Fire-and-Forget Forwarding

The plugin's forwarding to the chat router is designed to be resilient. If the HTTP request to the chat router fails for any reason (server down, network error, validation error), the plugin catches the error, logs it, and continues processing. The Telegram echo is not blocked or prevented by a chat router failure.

This means the plugin can start before the chat router is running, and it will function normally (in standalone echo mode) until the chat router becomes available. There is no startup dependency between the two processes.

## Message Splitting

Telegram imposes a 4096-character limit on message text. The splitMessage utility handles this by breaking long messages into chunks:

- If a message is within the limit, it is returned as-is in a single-element array.
- If it exceeds the limit, the utility looks for the last newline character within the allowed length and splits there, preserving readability.
- If no newline is found within the window, it hard-splits at the maximum length.
- The process repeats on the remaining text until everything fits.

This utility is used when echoing messages back. It is not needed for forwarding to the chat router, since the chat router has no message length limit.

## Configuration and Modes

The plugin's behavior is controlled by two environment variables:

**BOT_TOKEN** is required. Without it, the process exits immediately with an error message.

**CHAT_ROUTER_URL** is optional. Its presence or absence determines the plugin's operating mode:

- When set (e.g., http://localhost:3100), the plugin creates an HTTP client and operates in connected mode, forwarding all messages.
- When absent, the plugin operates in standalone mode with no chat router interaction.

The mode is determined at startup and logged to the console. There is no runtime switching between modes.
