# Implementation Plan: Chat Gateway

**Branch**: `002-chat-gateway` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

## Summary

Add a Neo Service Skill, `skills/chat-gateway`, that runs one PM2 service. The service subscribes to Relay job status events on NATS, reconciles against the dashboard job list, and sends job completion notifications through the existing Neo events notification path. The same service hosts a loopback MCP server (`chat_report`, `chat_env`) federated into Neo.app, so the orchestrator ChatGPT thread can report to the owner at its own discretion and learn the owner's execution environment. Relay, Events Bus, dashboard, Neo MCP and ChatGPT are not modified.

## Technical Context

- **Language**: Node.js 22+ ES modules
- **Dependencies**: `nats` client, MCP SDK, Node standard library; published `agents-relay` and `events-bus` are consumed only through NATS subjects and HTTP APIs
- **Storage**: Append-only JSONL ledgers plus small JSON snapshots under `~/.local/state/neo/chat-gateway/`
- **Tests**: Node built-in test runner with injected NATS, dashboard, notifier and clock
- **Platform**: macOS host running Neo.app, PM2 via `serviceman`
- **Constraints**: Loopback only; no changes to other modules; no job objectives or secrets in notifications; no thread liveness tracking
- **Scope**: Phase 1 only (see spec Out of Scope)

## Architecture and Decisions

1. **Service Skill pattern.** Follow `events-bus`: the Skill declares `requires.skills: [daemon-service-manage]`, owns its CLI, and defines exactly one service, `chat-gateway/server`, through `serviceman define --skill chat-gateway --service server --apply -- npx -y chat-gateway@latest serve`. Neo.app discovers declaring Skills, so it manages the service lifecycle without hardcoded names.
2. **Distribution.** Publish as an external npm package launched with `@latest`, matching `events-bus` and the root `AGENTS.md` rule that Neo.app-managed external packages use published `@latest` launchers. (Decision pending owner confirmation; see research O3.)
3. **Events in, ledger first.** Compute the key `job:<jobId>:<to>:<updatedAt>`, append to the ledger as `pending`, then deliver; mark `delivered` only with an acknowledgement. This makes restart, retry and duplicate event handling safe.
4. **Reconciliation closes the gap NATS leaves.** Relay's status change detector is process-local and silent on first observation, and core NATS has no replay. Reconciliation (start, reconnect, every 5 minutes) compares the dashboard job list to the Job Snapshot. The first run baselines silently.
5. **Notification path.** Use the existing Neo events notification (`events notify completed`) rather than a new push system. The service acts as an authenticated Neo MCP client for this call. (Invocation path pending verification; see research O1.)
6. **MCP hosted by the service.** Serve an HTTP MCP endpoint on loopback and register it with `neo mcp add chat-gateway http://127.0.0.1:<port>/mcp` during `setup`; tools appear as `mcp.chat-gateway.<tool>`. One process owns all state.
7. **Reporting is thread-initiated.** `chat_report` persists everything; only `attention` notifies, with a 60-second coalescing window. There is no per-turn report requirement and no liveness state.
8. **Environment is a small resolver.** override file, then observed signal (stub returning none in Phase 1), then weekday 08:00 to 18:00 heuristic. The result is returned by `chat_env`; thread-side wording stays in the Project instructions.
9. **Privacy by construction.** Notifications carry job title, terminal state, job id and repository only.

## Project Structure

```text
skills/chat-gateway/
  SKILL.md                      # Service Skill contract, bootstrap, service ownership
  package.json                  # bin: chat-gateway
  cli/chat-gateway.mjs          # setup | serve | health | status | env
  core/config.mjs               # NATS/dashboard/state-dir resolution
  core/ledger.mjs               # durable keys, pending/delivered, snapshots
  core/subscriber.mjs           # NATS subscription and event filtering
  core/reconcile.mjs            # dashboard diff, baseline
  core/notify.mjs               # Neo events notify client, retry/backoff, coalescing
  core/env.mjs                  # override/observed/heuristic resolver
  mcp/server.mjs                # chat_report, chat_env over loopback HTTP
  test/*.test.mjs               # isolated tests with injected adapters
docs/chat-gateway-orchestrator.md  # Project-instruction text for the orchestrator thread
```

The Spec Kit constitution file contains only placeholders; governing constraints are the root `AGENTS.md`, `skills/daemon-service-manage/SKILL.md` and the Events Bus protocol reference.

## Risks

- **R1 (blocking for US1)**: how a PM2 service calls `events notify`. Fallback: a documented loopback hook if one exists, otherwise Phase 1 ends at the ledger and `status`, and delivery waits on an owner decision.
- **R2**: `/api/jobs` is about 1 MB; poll sparingly and keep only id, title, state, repository and updatedAt.
- **R3**: Relay event shape may change; the filter tolerates unknown fields and rejects malformed events with bounded logging.
