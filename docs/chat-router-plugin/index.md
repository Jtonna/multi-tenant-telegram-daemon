# Chat Router Plugin: Telegram Integration

## What It Is

The Telegram integration is a platform-specific plugin for the MTTD system. It serves as the bridge between Telegram and the chat router -- connecting to the Telegram Bot API on one side and the chat router's normalized REST API on the other.

Each plugin runs as its own process and communicates with the chat router over HTTP. The Telegram plugin is the first of potentially many platform plugins (Discord, Slack, web, etc.).

## What It Does Today

The plugin is in its Phase 1 state: a working Telegram bot that receives real messages and optionally forwards them to the chat router. Specifically, it:

- Connects to Telegram using grammY long polling (no webhook server required).
- Responds to the `/start` command with a welcome message.
- Logs every incoming message in full detail to the console for exploring Telegram's data shapes.
- Maps each incoming Telegram message into the chat router's normalized InboundMessage format.
- Forwards that normalized message to the chat router's REST API (if configured).
- Echoes the message text back to the sender, splitting long messages to respect Telegram's 4096-character limit.

## Standalone vs Connected Mode

- **Connected mode**: When CHAT_ROUTER_URL is set, the plugin forwards every message to the chat router. If the chat router is unreachable, the error is logged but the bot continues operating.
- **Standalone mode**: When CHAT_ROUTER_URL is omitted, the plugin runs as a simple echo bot with no chat router interaction.

## How to Run

From the `telegram-integration/` directory:

1. Copy `.env.example` to `.env` and fill in the values.
2. Run with `npm run dev` for development or `npm run build && npm start` for production.

| Environment Variable | Required | Description |
|---|---|---|
| BOT_TOKEN | Yes | Telegram bot token from BotFather |
| CHAT_ROUTER_URL | No | Base URL of the chat router REST API (e.g., http://localhost:3100) |

## Dependencies

Runtime: **grammY** (Telegram Bot API framework) and **dotenv** (environment variable loading). No HTTP client library needed -- uses Node.js native fetch.

Run the test suite (22 tests):

    npm test

## Related Documentation

- [Architecture](architecture.md) -- Process boundaries, message flow, and the mapper pattern
- [Implementation Details](implementation.md) -- Factory functions, HTTP client, splitting algorithm, error handling, and tests
