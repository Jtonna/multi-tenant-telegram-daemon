# Chat Router Plugin: Telegram Integration

## Overview

The Telegram integration is a platform-specific plugin for the MTTD (Multi-Tenant Telegram Daemon) system. It serves as the bridge between Telegram and the chat router -- connecting to the Telegram Bot API on one side and the chat router's REST API and WebSocket endpoint on the other. Each plugin runs as its own process and communicates with the chat router via HTTP (for inbound messages) and WebSocket (for outbound messages).

The plugin supports bidirectional communication: inbound messages from Telegram are forwarded to the chat router via REST POST, and outbound messages from the chat router are received via WebSocket push events and delivered to Telegram. It is the first of potentially many platform plugins (Discord, Slack, web, etc.). See [Architecture](architecture.md) for details on how the pieces fit together.

## Documentation

- [Architecture](architecture.md) -- Design patterns, file structure, data flow diagrams, component descriptions, and configuration modes.
- [Implementation Details](implementation.md) -- Function signatures, class methods, field-by-field mapper transformations, the splitting algorithm, error handling specifics, and testing approach.

## How to Run

From the `telegram-integration/` directory:

1. Copy `.env.example` to `.env` and fill in the values.
2. Run with `npm run dev` for development or `npm run build && npm start` for production.
3. Run the test suite with `npm test`.

See [Configuration and Modes](architecture.md#configuration-and-modes) for environment variable details.
