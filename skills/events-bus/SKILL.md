---
name: events-bus
description: Shared event transport and simple publishing interface for Neo orchestrators and workers.
requires:
  skills:
    - daemon-service-manage
---

# Events bus

## Bootstrap

Run `events-bus setup` after installing the required `daemon-service-manage` Skill and its `serviceman` CLI. Setup declares exactly `events-bus/nats` and `events-bus/history` via `serviceman define`; repeated setup does not restart existing processes. Verify with `events-bus health` and `serviceman status --skill events-bus --service history`. Existing unqualified names must be migrated rather than recreated in parallel.

## Service ownership

Persistent services owned by this Skill require the global `daemon-service-manage` Skill. Register and manage each service through its CLI, using the enforced `<skillname>/<service-name>` identity; do not create new unqualified PM2 process names. Existing service names are migration inputs, not a reason to bypass namespacing.

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
Local worker helper: `node scripts/emit.mjs task.completed '{"verdict":"approved","head_sha":"abc"}'` with `EVENTS_BUS_EVENT_SOURCE` exported.

## Native package publication

After verifying the installed release, publish `package.published` with source
`release/<package>/<sha>` and data `package`, `version`, `sha`,
`registry: "native"`, and optional `jobId` (string). No synthetic Job or
Task identity is allowed. This uses the separate release subject, never the
legacy npm updater subject. Query durable history at
`GET /releases?package=<package>`; associated events also appear in Job
history but do not change Job lifecycle. Repeat the same SHA and metadata
to recover an uncertain publication without creating another history row.

## Generic reply events

The existing MCP `publish` tool also accepts generic reply events. No separate
reporting or reply tool is required. Give a **source** of
`reply/<channel>/<request_id>` (e.g. `reply/models/resp_<id>`), where
`channel` is a lowercase routing label and `request_id` is an opaque identifier.

- `reply.text`: `data: {"seq":1,"text":"first report"}`; increment `seq` for each fragment
- `reply.heartbeat`: `data: {}` (optional liveness)
- `reply.completed`: `data: {}`; **must be published separately** after all text
- `reply.failed`: `data: {"error":"actual reason"}` instead of completion

Each channel owner establishes a dedicated listener before dispatching a
request and handles its own delivery, deduplication, timeout and terminal
state. The Event Bus publishes these replies on the separate
`relay.events.reply.<channel>.<request_id>` NATS subjects (prefix derived from
the configured job subject prefix). Job lifecycle subjects and existing
job/task/execution producer contracts are unchanged. Do not use a real name,
phone number, or other personal data as `request_id`. Reply event contents
are **not** added to the job history recorder; each channel owner must persist
what it needs. Live NATS subscriptions do not replay missed messages.

To add a channel listener or extend reply behavior, follow the canonical
[reply-channel developer contract](references/channel-development.md); this Skill
contains only the publishing decision rules.

## Transport and consumers

The MCP tool is **publish-only**. Observation is independent: native NATS subscriptions, CLI `watch`/`wait`/`history`/`status`, and HTTP endpoints remain available to authorized consumers; `health`, `config`, and `setup` are CLI operations. Do not call MCP `watch`, `wait`, `history`, `status`, or `health`: they do not exist.

The events-bus core handles NATS transport and historical persistence. The continuous history service `api/server.mjs` records events; Agents Relay consumes NATS events and HTTP history. A launcher must arrange observation before dispatching workers when continuous observation is required.

## Transport configuration

All publishers, subscribers and recorders use `EVENTS_BUS_CONFIG`,
`EVENTS_BUS_DATA_DIR`, `EVENTS_BUS_NATS_URL`, `EVENTS_BUS_API_URL`,
`EVENTS_BUS_API_HOST`, `EVENTS_BUS_API_PORT`, and
`EVENTS_BUS_SUBJECT_PREFIX` (default `relay.events.job`).
`EVENTS_BUS_EVENT_SOURCE` is the CLI helper's execution-identity variable.
The retired Neo/Relay-prefixed event environment keys are unsupported.
For existing services, follow the coordinated
[namespace cutover procedure](references/relay-namespace-cutover.md) before
restarting or updating a live service.

## Internal compatibility

The serialized NATS envelope currently includes `job_id`, `task_id`, `type`, `status`, `source.id`, `data`, `message`, timestamps and IDs because existing consumers require them. **These are generated transport fields, not additional caller inputs.** This compatibility is intentional until consumers migrate. The bus does not decide task state; Agents Relay interprets correlated lifecycle events, including Reviewer results in `data`.

See `references/protocol.md` for the exact transport/consumer boundaries. Preserve valid source identities, avoid secrets in event data, and do not publish terminal events on behalf of another execution.
