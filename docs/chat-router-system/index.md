# Chat Router System

## What It Is

The chat router is the central routing hub of the Multi-Tenant Telegram Daemon (MTTD) system. It sits between platform plugins (Telegram, Discord, web) and the AI processing layer (ACS), providing a single point through which all messages flow. Every inbound message from any platform is normalized into a common format, persisted to a unified timeline, and made available through a REST API. Outbound responses follow the reverse path.

The chat router runs as its own process. Plugins and external clients are separate processes that communicate with it over HTTP. This separation means the chat router owns all message data and business logic, while plugins only handle platform-specific concerns.

## What It Does Today

The chat router currently provides three functional layers:

- **Service layer** -- All business logic for ingesting messages, recording responses, querying timelines, and managing conversations. The service validates inputs, normalizes data, and delegates to the persistence layer.
- **REST API** -- An Express-based HTTP server that exposes seven endpoints for submitting messages, retrieving timelines, listing conversations, and checking system health. All endpoints are mounted under the "/api" prefix.
- **JSON file persistence** -- A file-backed store that keeps all timeline entries and conversations in a single JSON file on disk. It supports an in-memory mode for testing.

The system supports three platform types: Telegram, Discord, and web. Messages from any platform are normalized into the same data model and stored in a single unified timeline.

## What Is Not Yet Implemented

- **Daemon CLI adapter** -- A command-line interface for local processes to call the service layer without HTTP.
- **WebSocket adapter** -- Real-time bidirectional communication for clients that need push notifications.
- **SQLite persistence** -- The JSON file store is designed to be swappable for SQLite.
- **ACS integration** -- Forwarding messages to ACS for AI processing and routing responses back.

## How to Run

Start the development server with hot reload from the `chat-router/` directory:

    npm run dev

The server listens on port 3100 by default.

| Variable | Default | Purpose |
|---|---|---|
| CHAT_ROUTER_PORT | 3100 | HTTP port the server binds to |
| CHAT_ROUTER_DATA_DIR | ./data | Directory where the JSON persistence file is written |

Run the test suite (33 tests):

    npm test

## Further Reading

- [Architecture](architecture.md) -- Layered design, data flow, the normalized message model, and platform abstraction
- [Implementation Details](implementation.md) -- REST API endpoints, service methods, store internals, error handling, and testing
