---
name: events-bus
description: Shared event transport and simple publishing interface for Neo orchestrators and workers.
---

# Events bus

## Publish contract

**MCP exposes exactly one tool: `publish`.** MCP and CLI publishers send exactly three fields:

```json
{
  "type": "task.completed",
  "source": "job/478/task/final-review/execution/abc",
  "data": { "verdict": "approved", "head_sha": "abc", "findings": [] }
}
```

- `type`: event kind.
- `source`: authoritative job/task/execution identity provided by the launcher. Copy unchanged.
- `data`: business result or structured event details; use `data.message` for optional human-readable information.

No caller-facing `status`, `visibility`, `message`, or `progress`. The shared `core/publish-envelope.mjs` adapter derives legacy internal NATS/Relay metadata. Never put a Reviewer verdict into `progress`.

Publish from CLI: `events-bus publish --file event.json` (or one quoted JSON argument).
Local worker helper: `node scripts/emit.mjs task.completed '{"verdict":"approved","head_sha":"abc"}'` with `NEO_EVENT_SOURCE` exported.

## Transport and consumers

The MCP tool is **publish-only**. Observation is independent: native NATS subscriptions, CLI `watch`/`wait`/`history`/`status`, and HTTP endpoints remain available to authorized consumers; `health`, `config`, and `setup` are CLI operations. Do not call MCP `watch`, `wait`, `history`, `status`, or `health`: they do not exist.

The events-bus core handles NATS transport and historical persistence. The continuous history service `api/server.mjs` records events; Agents Relay consumes NATS events and HTTP history. A launcher must arrange observation before dispatching workers when continuous observation is required.

## Internal compatibility

The serialized NATS envelope currently includes `job_id`, `task_id`, `type`, `status`, `source.id`, `data`, `message`, timestamps and IDs because existing consumers require them. **These are generated transport fields, not additional caller inputs.** This compatibility is intentional until consumers migrate. The bus does not decide task state; Agents Relay interprets correlated lifecycle events, including Reviewer results in `data`.

See `references/protocol.md` for the exact transport/consumer boundaries. Preserve valid source identities, avoid secrets in event data, and do not publish terminal events on behalf of another execution.
