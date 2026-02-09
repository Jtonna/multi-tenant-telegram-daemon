# Multi-Tenant Telegram Daemon (MTTD) — Plan v2

## Architecture

Multi-process system. The chat router is a central routing hub (daemon). Plugins (Telegram, Discord, etc.) and external clients (Vantage Search web UI) are separate processes that communicate with the chat router.

```
Same machine (default):
  Telegram Plugin (process) ──daemon CLI──→ Chat Router (daemon) ──→ ACS

Remote / cloud:
  Web UI (Vantage Search) ──REST + WebSocket──→ Chat Router ──→ ACS
```

### Communication Modes

| Mode | When | Who |
|------|------|-----|
| Daemon CLI | Default — same machine | Telegram plugin, local plugins |
| REST API | Cloud / remote clients | Vantage Search, off-machine services |
| WebSocket | Real-time bidirectional | Vantage Search, any client needing push |

Daemon CLI follows the same pattern as ACS and WebPilot: the chat router runs as a background service, and callers invoke the executable with flags.

### Service Layer Pattern

The chat router defines a **single service layer** with all business logic. Three transport adapters expose the same methods:

```
Service Layer (source of truth)
  ├── Daemon CLI adapter
  ├── REST adapter
  └── WebSocket adapter
```

No business logic in the transport layer. All three adapters call into the same service methods.

### Data

- **SQLite** for message persistence (unified timeline across all channels)
- Lives in the chat router's data directory — only the chat router reads/writes it
- Plugins and web UI access message data through the chat router API
- Timeline entries track which platform each message came from

### Process Boundaries

- **Chat Router**: Daemon process. Routes messages, persists to SQLite, talks to ACS.
- **Plugins** (Telegram, Discord, etc.): Separate processes. Handle platform-specific APIs. Talk to chat router via daemon CLI (local) or REST/WS (remote).
- **Vantage Search (Web UI)**: Separate program entirely. Talks to chat router via REST + WebSocket, even when running locally.
- **ACS**: Existing system. Chat router forwards messages to it for AI processing.

## Phases

### Phase 1: Telegram Plugin (standalone)
- Set up grammY bot, receive real Telegram messages, send responses
- Expose via CLI command or simple API for manual testing
- Goal: understand the data shapes, get comfortable with Telegram API
- Connect to a real Telegram bot for live testing

### Phase 2: Chat Router System
- Separate daemon process with the service layer
- Design wire protocol informed by Phase 1 data shapes
- SQLite message persistence for unified timeline
- Daemon CLI, REST, and WebSocket adapters

### Phase 3: Boilerplate Plugin
- Plugin template extracted from Telegram plugin patterns
- Defines the contract any plugin must follow to talk to the chat router
- Reference implementation for future plugins (Discord, Slack, etc.)

### Phase 4: Integration
- Telegram plugin talks to chat router via daemon CLI
- Chat router forwards to ACS, routes responses back
- End-to-end: Telegram message → plugin → router → ACS → router → plugin → Telegram reply

## Notes

- Technical documentation should be maintained alongside implementation — each package gets proper docs covering its API, configuration, and usage patterns.
- The deprecated v1 plan (`_PLAN_DEPRECATED.md`) can be referenced for config format details, CLI flags, and other specifics that still apply. Cherry-pick what's relevant as each phase is implemented.
- ACS ENH-001 (dynamic trigger parameters) is still a dependency for Phase 4.
