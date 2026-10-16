# Events-bus protocol

## Public publishing API

MCP exposes **publish only**. The CLI `events-bus publish` uses the same input:

```json
{
  "type": "task.completed",
  "source": "job/478/task/final-review/execution/abc",
  "data": {
    "verdict": "approved",
    "head_sha": "abc",
    "findings": []
  }
}
```

`type` and `source` are required. `data` defaults to `{}`. Source is the precise execution identity assigned by the launcher: `job/<job-id>/task/<task-id>/execution/<execution-id>`. Never invent this identity. Terminal Reviewer evidence belongs in `data`, not `progress`.

The CLI accepts `events-bus publish --file event.json` or `events-bus publish '<json>'`. Direct local workers can use `scripts/emit.mjs <type> [data-json]` with `NEO_EVENT_SOURCE` set. Sandboxed workers use MCP `publish`.

## Internal transport compatibility

The adapter `core/publish-envelope.mjs` expands those fields to the legacy internal NATS envelope:
- `job_id`, `task_id`: parsed from `source`;
- `source.id`: exact original `source`;
- `status`: derived from event type, for compatibility;
- `visibility`: defaults to `orchestrator`;
- `message`: `data.message` when present or the event type;
- `data`: passed through unchanged;
- `version`, `event_id`, `timestamp`, `level`: populated by events-bus core.

The caller does not supply `status`, `visibility`, `message`, `progress` or transport identifiers. Old direct NATS/HTTP producers still use the internal envelope until migrated. Existing consumers, including Agents Relay, still process the internal envelope. Do not use the presence of `status` as an independent authority for task state.

## Transport, observation, history

NATS subject: `neo.events.job.<job_id>.<type>`. Observe `neo.events.job.<job_id>.>`; the history service `api/server.mjs` continuously records events even if there is no MCP client.

MCP has no observation tools. Authorized observers use native NATS or:
- CLI: `events-bus watch|wait|history|status|health|config`;
- HTTP: `GET /watch`, `/wait`, `/events`, `/status`, `/health`, `/config`.

Establish observation before launching workers where continuous progress tracking matters. The owning orchestrator translates relevant events into user-facing progress. Ordinary worker completion and review approval are distinct from successful delivery of the event: the consumer must validate execution identity, current task generation and domain payload.

## Lifecycle semantics

`task.started` indicates execution began. `task.completed` and `task.failed` are task terminal outcomes; Relay owns durable transitions. Ordinary Relay Worker/Reviewer agents do not emit `task.blocked`; only the authorized Troubleshooter escalation flow may request a real user action. Carrier events such as `task.process.async_exited` are not terminal worker outcomes. The owning application defines the meaning of `data` for each event kind.

The event publisher must not change a supplied execution identity, synthesize success, or leak secrets. Errors in transport publishing are not proof of failure of the underlying business operation; the caller should preserve evidence and reconcile safely.
