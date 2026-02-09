# Multi-Tenant Telegram Daemon (MTTD)

A multi-process chat routing system that sits between messaging platforms (Telegram, Discord, etc.) and [ACS (Agent Cron Scheduler)](https://github.com) for AI agent execution. Users interact with AI agents via their preferred messaging platform, and the chat router handles message routing, persistence, and session management.

## Architecture

- **Chat Router** — Central daemon process. Routes messages between plugins and ACS, persists a unified message timeline to SQLite.
- **Plugins** (Telegram, Discord, etc.) — Separate processes that handle platform-specific APIs and communicate with the chat router.
- **Vantage Search (Web UI)** — Separate program that connects to the chat router via REST + WebSocket.

The chat router exposes a single service layer with three transport adapters: daemon CLI (local), REST API (remote), and WebSocket (real-time). See [PLAN.md](PLAN.md) for full architecture details and implementation phases.

## Status

Phase 1 — Setting up the Telegram plugin as a standalone bot for live testing.

## Issue Tracking

This project uses [beads](https://github.com/steveyegge/beads) for git-backed issue tracking. Issues live in `.beads/issues.jsonl` and sync to the GitHub Projects kanban board when merged to `main`. See [BEADS_SYNC.md](BEADS_SYNC.md) for details.

