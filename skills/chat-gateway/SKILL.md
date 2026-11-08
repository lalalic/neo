---
name: chat-gateway
description: Relay terminal-state notifications and optional orchestrator reports for the Neo mobile entry point (Phase 1).
requires:
  skills:
    - daemon-service-manage
---

# Chat Gateway

## Purpose and bounds

The single service `chat-gateway/server` monitors Relay `job.runtime_status.changed` events and reconciles dashboard jobs. On a newly observed `COMPLETED` or `CANCELLED` transition, it uses Neo.app's existing `events notify completed` transport to notify the paired phone. The first start silently baselines existing terminal jobs. No Relay, Events Bus, dashboard, Neo.app or mobile app code is modified.

The service also hosts `http://127.0.0.1:8791/mcp`. Neo federation exposes one proxy tool `mcp.chat-gateway`; invoke `command: "chat_report"` (optional per-thread reporting; `attention` pushes, `info` only records) or `command: "chat_env"` (office/home override then observation then weekday heuristic). It does not bridge raw ChatGPT messages, implement a Chat tab, track thread liveness, or handle approvals.

## Setup and service ownership

Requires `daemon-service-manage` and `serviceman`. Define only `chat-gateway/server`, managed by PM2. Distribute a package artifact, not a checkout path. For local testing, package once with `npm pack --pack-destination <stable-private-folder>` then run `chat-gateway setup --package /absolute/path/to/package.tgz --apply`. Registry publication requires separate owner permission; if published, use a verified `@latest` launcher. `chat-gateway setup` (no `--apply`) prints a zero-write plan. `serviceman status --skill chat-gateway --service server`, `chat-gateway health` and `chat-gateway status` verify the service. Never use Relay Jobs to run this service.

## MCP contract

- `chat_report({ text, level?: "info"|"attention", jobId?, needs?: "work_node"|"phone"|"none" })`: text is 1–2000 characters. Every valid report is persisted. An attention report is eligible for one phone notification; repeated reports are throttled in a 60-second window. Only call when the orchestrator judges it useful.
- `chat_env({})`: returns `{ mode, source, since, phone: { channel } }`. Override is set by `chat-gateway env set office|home|auto --apply`; the fallback is local weekdays 08:00–18:00 as office.

## Diagnostics and privacy

State: `~/.local/state/neo/chat-gateway/` (private ledger/snapshot/env). Health includes NATS connectivity, dashboard reconciliation, notifier reachability and pending count. `chat-gateway serve --dry-run` uses temporary state and never pushes. Job notifications include only title, state, id and repository; no objective, prompts, paths, media, secrets or per-turn stream. See `specs/002-chat-gateway/` for the Phase 1 requirements and tests.
