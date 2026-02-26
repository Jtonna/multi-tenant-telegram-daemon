# Chat Router System: Architecture

## Design Pattern: Layered Architecture with Service Layer

The chat router follows a **Layered Architecture** organized around a central **Service Layer** (also known as the Application Service pattern). The service layer contains all business logic and defines a contract (`IChatRouterService`) that transport adapters implement against. Transport adapters (REST today, Daemon CLI and WebSocket planned) are thin translation layers that convert protocol-specific requests into service method calls. The persistence layer (`ChatRouterStore`) is injected into the service, making it swappable.

Dependencies flow strictly downward -- the REST API depends on the service, the service depends on the store, and all layers depend on the shared type definitions. No layer reaches upward.

## File Structure

```
chat-router/
  package.json              -- Package manifest; defines dev, build, start, test scripts
  src/
    index.ts                -- Entry point; wires Store -> Service -> Server, calls listen(), handles shutdown
    types.ts                -- All shared types and the IChatRouterService interface contract
    service.ts              -- ChatRouterService class; all business logic (implements IChatRouterService)
    db/
      store.ts              -- ChatRouterStore class; SQLite-backed persistence via better-sqlite3 (or :memory: for tests)
    api/
      server.ts             -- createServer() factory; creates Express app, mounts CORS middleware, JSON parser, API router, and global error handler
      router.ts             -- createApiRouter() factory; maps HTTP endpoints to IChatRouterService methods
    scripts/
      seed.ts               -- Inserts fake Telegram messages via the service layer (npm run seed)
      query.ts              -- Queries the running chat router via HTTP REST API (npm run query)
    __tests__/
      store.test.ts         -- 9 tests for the persistence layer
      service.test.ts       -- 12 tests for the business logic layer
      api.test.ts           -- 12 tests for the HTTP adapter layer
```

## Configuration

The entry point reads two environment variables:

- **`CHAT_ROUTER_PORT`** -- TCP port for the HTTP server (default: `3100`).
- **`CHAT_ROUTER_DATA_DIR`** -- Directory for the SQLite database file (default: `./data`).

## Architectural Diagram

```mermaid
graph TD
    Client["HTTP Client / Plugin"]

    subgraph "chat-router process"
        Entry["index.ts<br/><i>wiring + lifecycle</i>"]

        subgraph "REST API Layer"
            Server["api/server.ts<br/><i>Express app factory</i>"]
            Router["api/router.ts<br/><i>route handlers</i>"]
        end

        subgraph "Service Layer"
            Service["service.ts<br/><i>ChatRouterService</i><br/><i>validation, orchestration</i>"]
        end

        subgraph "Persistence Layer"
            Store["db/store.ts<br/><i>ChatRouterStore</i><br/><i>SQLite file or :memory:</i>"]
        end

        DataFile["data/chat-router.db"]
    end

    Types["types.ts<br/><i>shared by all layers</i>"]

    Client -->|"HTTP request"| Server
    Server --> Router
    Entry -->|"wires"| Server
    Entry -->|"wires"| Service
    Entry -->|"wires"| Store
    Router -->|"calls IChatRouterService methods"| Service
    Service -->|"calls ChatRouterStore methods"| Store
    Store -->|"SQLite read/write"| DataFile
    Types -.->|"imported by"| Router
    Types -.->|"imported by"| Service
    Types -.->|"imported by"| Store
```

## Layered Design

The four layers and their responsibilities:

1. **Types** (`types.ts`) -- Defines all data structures (`InboundMessage`, `TimelineEntry`, `OutboundMessage`, `Conversation`) and the service interface contract (`IChatRouterService`). Every other layer imports from types, but types import nothing.

2. **Persistence** (`db/store.ts`) -- Reads and writes timeline entries and conversations. The current implementation is backed by SQLite via better-sqlite3. It uses WAL journal mode for file-based databases and `:memory:` mode for tests. The store also exposes a `getStats()` method returning aggregate message and conversation counts used by the health check endpoint. The store interface is designed so that the backing storage could be swapped without changing any other layer. See [Implementation Details](implementation.md#store-internals) for internal mechanics.

3. **Service** (`service.ts`) -- All business logic. Validates inputs, transforms inbound messages into the internal data shape, orchestrates store operations, and provides the seven methods defined by `IChatRouterService`. This is the source of truth for the system's behavior.

4. **REST API** (`api/server.ts`, `api/router.ts`) -- A thin Express-based HTTP adapter that translates HTTP requests into service method calls. Contains no business logic. The `createServer()` factory configures CORS, JSON parsing, the API router, and a global error handler, then returns the Express app without calling `.listen()`, keeping it testable with supertest. The entry point (`index.ts`) calls `.listen()` and handles graceful shutdown on SIGINT/SIGTERM, closing both the HTTP server and the database connection.

## Data Flow

When a message arrives via the REST API:

1. The Express router receives the HTTP request and parses the JSON body.
2. The router calls the corresponding service method (e.g., `ingestMessage`).
3. The service validates the input and transforms it into the internal data shape.
4. The service calls the store's `ingestTransaction`, which wraps a timeline entry insert and conversation upsert in a SQLite transaction (atomic). SQLite assigns an auto-increment ID during the insert.
5. The completed `TimelineEntry` is returned up through the layers to the HTTP response.

Outbound responses follow the same path through `recordResponse`, with direction set to `"out"`. The service sets senderName to `"System"`, senderId to `"system"`, and generates a synthetic platform message ID in the format `router-N` using an in-memory counter.

Query operations (timeline retrieval, conversation listing) follow the same layered path: the REST router parses query parameters, calls the appropriate service method, which delegates to the store, and the result is returned as JSON. The unified timeline (`GET /api/timeline`) returns entries across all platforms. Timeline queries support cursor-based pagination via `after` (entries with id > value) and `before` (entries with id < value) parameters. The default page size is 50 entries, ordered by ID descending (newest first).

## Normalized Message Model

All messages are normalized to a common format regardless of which platform they came from.

**InboundMessage** is what plugins send to the chat router. It captures platform origin, sender identity, message content, and an optional `platformMeta` bag for preserving platform-specific data. All IDs are strings to accommodate different platforms. See `types.ts` for the full field list.

**TimelineEntry** is the persisted form. It adds an auto-increment ID, a direction field (`"in"` or `"out"`), and an ISO 8601 `createdAt` timestamp. The `platformMeta` is serialized to a JSON string for storage. This is what all query methods return.

**OutboundMessage** is defined in `types.ts` as a data structure for responses delivered back to a platform, containing a timeline entry ID, target platform and chat ID, response text, and an optional `inReplyTo` reference. Note: this type is not currently used by any service method or endpoint; responses are recorded via `recordResponse()` which accepts a plain parameter object and returns a `TimelineEntry`.

**Conversation** tracks unique `(platform, platformChatId)` pairs with timestamps and a running message count. Each conversation is assigned an auto-increment ID. Conversations are created automatically when the first message from a new chat is ingested and are never explicitly created or deleted by API callers.

## Platform Abstraction

The system defines three platform types: `"telegram"`, `"discord"`, and `"web"`. All platform-specific data is carried in two places:

- **`platformChatType`** captures platform-specific chat classifications (e.g., Telegram's `"private"`, `"group"`, `"supergroup"`).
- **`platformMeta`** is a freeform JSON bag where plugins can stash any platform-specific data they want preserved (e.g., Telegram's full User object, Discord guild information).

The chat router never interprets `platformMeta`. It stores and returns it as-is. This means new platform-specific fields can be added without any changes to the chat router code.
