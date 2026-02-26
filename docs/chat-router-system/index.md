# Chat Router System

The chat router is the central routing hub of the Multi-Tenant Telegram Daemon (MTTD) system. It sits between platform plugins (Telegram, Discord, web) and the AI processing layer (ACS), providing a single point through which all messages flow. Every inbound message from any platform is normalized into a common format, persisted to a unified timeline, and made available through a consistent API. Outbound responses follow the reverse path.

The chat router runs as its own process. Plugins and external clients are separate processes that communicate with it over HTTP, WebSocket, or the built-in CLI. This separation means the chat router owns all message data and business logic, while plugins only handle platform-specific concerns. Persistence is backed by SQLite via `better-sqlite3`. The server enables CORS for all origins by default. The service layer (`ChatRouterService`) extends `EventEmitter`, emitting `message:new` events that power real-time WebSocket push notifications to connected clients.

## Transports

The entry point (`src/index.ts`) supports two modes:

- **Daemon mode** (default) -- starts an Express HTTP server with a WebSocket server attached at `/ws`. The WebSocket adapter broadcasts `new_message` push notifications whenever a message is ingested or a response is recorded, and supports request/response queries (`health`, `conversations`, `timeline`, `unified_timeline`).
- **CLI mode** -- when the first argument is a recognized command, the process delegates to the CLI adapter instead of starting the daemon. The CLI talks to a running daemon over HTTP.

## Documentation

- [Architecture](architecture.md) -- Design pattern, file structure, architectural diagram, layered design, data flow, normalized message model, and platform abstraction.
- [Implementation Details](implementation.md) -- REST API endpoints, service method behavior, store internals, error handling, and testing approach.

## Source Layout

```
chat-router/src/
  index.ts          Entry point (mode detection, server startup, graceful shutdown)
  service.ts        ChatRouterService (business logic, EventEmitter)
  types.ts          Shared TypeScript types
  api/              Express HTTP routes
  cli/              CLI adapter and HTTP client
  ws/               WebSocket adapter and protocol types
  db/               SQLite store
  scripts/          seed and query helper scripts
  __tests__/        Vitest test suite
```

## How to Run

Start the development server with hot reload from the `chat-router/` directory:

    npm run dev

The server listens on port 3100 by default. Configuration is controlled entirely through environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `CHAT_ROUTER_PORT` | `3100` | HTTP port the server binds to |
| `CHAT_ROUTER_DATA_DIR` | `./data` | Directory where the SQLite database file is written (`chat-router.db`) |
| `CHAT_ROUTER_URL` | `http://localhost:3100` | Base URL used by the CLI adapter (and the Telegram plugin) to reach the daemon. In the Telegram plugin, leaving this unset causes the bot to run in standalone mode (echo only). |

Build and run the compiled version:

    npm run build
    npm start

The daemon handles `SIGINT` and `SIGTERM` gracefully, closing the HTTP server and the SQLite store before exiting.

### CLI

Use `npm run cli` to interact with a running daemon:

    npm run cli health
    npm run cli conversations
    npm run cli timeline [platform] [chatId] [--after N] [--limit N]
    npm run cli ingest --json '{ ... }'
    npm run cli respond --json '{ ... }'

### Tests

Run the test suite (56 tests across 5 files):

    npm test

Run tests in watch mode:

    npm run test:watch

### Utilities

Seed the database with sample inbound messages and outbound responses:

    npm run seed

Query the running chat router to inspect conversations and timelines:

    npm run query

## npm Scripts

| Script | Command | Purpose |
|---|---|---|
| `dev` | `tsx watch src/index.ts` | Start dev server with hot reload |
| `build` | `tsc` | Compile TypeScript |
| `start` | `node dist/index.js` | Run compiled daemon |
| `test` | `vitest run` | Run test suite once |
| `test:watch` | `vitest` | Run tests in watch mode |
| `seed` | `tsx src/scripts/seed.ts` | Seed database with sample data |
| `query` | `tsx src/scripts/query.ts` | Query running daemon |
| `cli` | `tsx src/index.ts` | Run a CLI command against the daemon |

## Key Dependencies

| Package | Purpose |
|---|---|
| `express` | HTTP server and routing |
| `better-sqlite3` | SQLite persistence |
| `ws` | WebSocket server |
| `cors` | Cross-origin request support |

## Cross-Service Interaction

The Telegram plugin (`telegram-integration`) uses `CHAT_ROUTER_URL` to locate the chat router. On startup it performs a health check; if the router is unreachable it logs a warning but continues starting. When `CHAT_ROUTER_URL` is not set, the Telegram bot runs in standalone mode (echo only) without forwarding messages to the router.
