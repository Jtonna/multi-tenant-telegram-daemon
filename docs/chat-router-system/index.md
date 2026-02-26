# Chat Router System

The chat router is the central routing hub of the Multi-Tenant Telegram Daemon (MTTD) system. It sits between platform plugins (Telegram, Discord, web) and the AI processing layer (ACS), providing a single point through which all messages flow. Every inbound message from any platform is normalized into a common format, persisted to a unified timeline, and made available through a consistent API. Outbound responses follow the reverse path.

The chat router runs as its own process. Plugins and external clients are separate processes that communicate with it over HTTP. This separation means the chat router owns all message data and business logic, while plugins only handle platform-specific concerns. Persistence is backed by SQLite via `better-sqlite3`. The server enables CORS for all origins by default. Future transport adapters (Daemon CLI, WebSocket) are planned; see the [project plan](../../PLAN.md) for the roadmap.

## Documentation

- [Architecture](architecture.md) -- Design pattern, file structure, architectural diagram, layered design, data flow, normalized message model, and platform abstraction.
- [Implementation Details](implementation.md) -- REST API endpoints, service method behavior, store internals, error handling, and testing approach.

## How to Run

Start the development server with hot reload from the `chat-router/` directory:

    npm run dev

The server listens on port 3100 by default. Configuration is controlled entirely through environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `CHAT_ROUTER_PORT` | `3100` | HTTP port the server binds to |
| `CHAT_ROUTER_DATA_DIR` | `./data` | Directory where the SQLite database file is written (`chat-router.db`) |

Build and run the compiled version:

    npm run build
    npm start

Run the test suite (33 tests across 3 files):

    npm test

Seed the database with sample inbound messages and outbound responses:

    npm run seed

Query the running chat router to inspect conversations and timelines:

    npm run query
