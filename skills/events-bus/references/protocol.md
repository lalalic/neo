# Events Bus Protocol

This document is the canonical contract for progress and lifecycle events exchanged between Neo orchestrators and sub-agents. Transport is intentionally separate from this protocol. The current implementation uses NATS internally, but the event model must remain usable with another transport later.

## Goal

A user must not have to ask "what is happening?" while an orchestrated job is running. Every long-running sub-agent must publish structured lifecycle/progress events, and the orchestrator that owns the job must actively surface user-visible milestones.

## Correlation model

The orchestrator creates a globally unique, transport-safe `job_id` before starting work and passes it to every direct child. Use only letters, digits, `_`, and `-` in the ID; do not put `.` in it. Nested children inherit the same `job_id` and set `parent_task_id` to the task that spawned them.

Recommended environment variables:

- `NEO_JOB_ID` — required for every event belonging to an orchestrated job.
- `NEO_ORCHESTRATOR_ID` — stable identifier for the orchestrator instance/session when available.
- `NEO_TASK_ID` — identifier for the current task/sub-agent.
- `NEO_PARENT_TASK_ID` — parent task when work is nested.
- `NEO_NATS_URL` — transport endpoint; default `nats://127.0.0.1:4222`.
- `NEO_EVENTS_BUS_DIR` — absolute path to the loaded events-bus skill directory for local workers.
- `NEO_EVENTS_EMIT` — absolute path to `scripts/emit.mjs`; use it only for direct non-sandbox local workers that can reach NATS. Sandboxed Codex workers should use MCP `events__publish`.

The `job_id` is the primary routing key. Do not use a process ID, Codex thread ID, chat ID, or host name as a substitute.

## Current transport subject convention

Canonical subject:

```text
neo.events.job.<job_id>.<type>
```

Examples:

```text
neo.events.job.01abc.task.started
neo.events.job.01abc.publish.upload.progress
neo.events.job.01abc.phone.released
neo.events.job.01abc.task.blocked
neo.events.job.01abc.task.completed
```

An orchestrator subscribes to:

```text
neo.events.job.<job_id>.>
```

A diagnostics/dashboard process may subscribe to:

```text
neo.events.job.>
```

## Semantic event ownership

The events bus owns the common envelope and delivery semantics, not the complete catalog of semantic event types. Each skill/component SHOULD define the domain-specific events it emits in its own `Events` section (or a referenced event contract). Event names and domain-specific `data` fields are therefore extensible without changing this protocol, but every emitted event MUST conform to the envelope, status, visibility, level, correlation, security, and display rules in this document.

One global transparency requirement applies to agent/worker execution: when a component selects or starts an agent/worker, it MUST publish a user-visible event that reports the selected model and configured reasoning/thinking level when those values are known. The owning skill chooses the event type and payload shape. Unknown values must remain unknown rather than being inferred.

## Event envelope

Every event is UTF-8 JSON with these fields:

```json
{
  "version": 1,
  "event_id": "0199...",
  "job_id": "0199...",
  "orchestrator_id": "chatgpt:...",
  "task_id": "publish-xhs",
  "parent_task_id": null,
  "type": "publish.upload.progress",
  "status": "running",
  "timestamp": "2026-09-13T19:12:00Z",
  "source": {
    "agent": "codex",
    "host": "chengli.local"
  },
  "visibility": "user",
  "level": "info",
  "message": "小红书视频上传中 66%",
  "progress": {
    "current": 66,
    "total": 100,
    "unit": "percent"
  },
  "data": {}
}
```

### Required fields

- `version`
- `event_id`
- `job_id`
- `task_id`
- `type`
- `status`
- `timestamp`
- `visibility`
- `level`
- `message`

### Status values

- `queued`
- `running`
- `waiting`
- `blocked`
- `succeeded`
- `failed`
- `cancelled`

### Visibility values

- `user` — the owning orchestrator must proactively surface this event to the user, subject to progress throttling below.
- `orchestrator` — useful to orchestration logic but normally not shown verbatim.
- `debug` — diagnostics only.

### Level values

- `debug`
- `info`
- `warning`
- `error`

## Mandatory lifecycle events

The owning orchestrator emits `job.started` once before delegation and exactly one top-level terminal event: `job.completed`, `job.failed`, `job.blocked`, or `job.cancelled`.

Every task lasting more than a few seconds must emit:

1. `task.started` when real execution starts.
2. Meaningful milestone/progress events during work.
3. Exactly one terminal event: `task.completed`, `task.failed`, `task.blocked`, or `task.cancelled`.

### Task visibility policy

- `task.started` and meaningful milestones may be `visibility: user` when useful.
- `task.failed`, `task.blocked`, and `task.cancelled` MUST be `visibility: user` and surfaced immediately.
- Routine successful child `task.completed` SHOULD default to `visibility: orchestrator` while the parent still reconciles or consumes results and will shortly emit a user-visible top-level `job.completed`.
- Child `task.completed` may be `visibility: user` only when its completion is a meaningful standalone user milestone; if so, the render-before-next-tool-call barrier remains mandatory.
- Top-level `job.completed`, `job.failed`, `job.blocked`, and `job.cancelled` remain user-visible terminal results.

A sub-agent must also emit a user-visible event immediately when control of a scarce user resource is released. For NeoX this is `phone.released`: after this event the remaining job must not require NeoX to remain foreground unless a new phone transaction explicitly starts.

Long silent periods are not allowed. If no meaningful milestone occurs for 30 seconds during active work, emit `task.heartbeat` with `visibility: orchestrator` and a concise description of the current operation. Heartbeats are not normally shown to the user.

## Progress semantics

Use `progress` only when the underlying operation exposes meaningful measurable progress. Never invent a percentage.

For noisy progress such as upload/render percentages, the orchestrator should display the first update, then updates at meaningful deltas (recommended: at least 10 percentage points or 10 seconds), plus 100%. Milestones, warnings, blocked states, failures, `phone.released`, and terminal events are never throttled away.

## Orchestrator event loop

The owning orchestrator MUST keep consuming the job event stream until either it observes a top-level terminal job event or the registered worker process is no longer alive. Event consumption is a loop, not a one-shot query.

Required behavior:

- establish a pre-launch watch capability before `job.started` or delegated work on request/response MCP hosts: prefer `events__watch(job_id)` for a non-blocking cursor; if unavailable, only for a newly-created unique job with no prior events, use `events__history(job_id, after_cursor=0, limit=1)` and use cursor `0` when empty; never use that fallback for an existing/resumed job with an unknown cursor; native transports may use their equivalent non-blocking subscription cursor;
- maintain a cursor (or equivalent transport position) and advance it only from observed events;
- render every relevant `visibility=user` milestone as a normal assistant-visible progress message as soon as practical;
- enforce a **render-before-next-tool-call barrier**: once a `wait` result contains a `visibility:user` event, the owning orchestrator must emit the human-readable assistant progress message before issuing any later tool call, including another `wait`;
- never treat the tool-call trace itself as user-visible progress;
- do not expose raw JSON unless the user asks for diagnostics;
- a `wait`/long-poll timeout means only “no new event in this window” and MUST NOT terminate an otherwise-active job;
- each MCP `wait` MUST check the registered local worker process before and during the long-poll. A local process-backed job SHOULD publish `data.worker = { kind: "process", pid, host }`; if that process exits, `wait` MUST return immediately and the orchestrator MUST stop the loop. If no top-level terminal job event exists, the result is abnormal/uncertain and MUST be surfaced as such;
- continue after `task.completed` when the top-level job is still active;
- stop after observing one of `job.completed`, `job.failed`, `job.blocked`, or `job.cancelled`, OR when the registered worker process exits; reconcile the two signals when both are available;
- if the worker exits, disappears, or becomes unreachable without a terminal job event, surface the mismatch and terminate as failed/blocked rather than silently ending observation.

For request/response MCP clients, use this ordered sequence: establish watch capability (`events__watch(job_id)` preferred; otherwise fresh unique job only: `events__history(job_id, after_cursor=0, limit=1)`) → remember `after_cursor` → publish/render required pre-launch routing → launch worker → `wait(job_id, after_cursor, timeout_ms)` → render returned user-visible events → repeat until a top-level terminal job event is observed. The history fallback is invalid for existing/resumed jobs with unknown cursors. Both watch forms are non-blocking and do not consume or delete events. A blocking `wait` before launch is not a valid substitute.

## Orchestrator display contract

The orchestrator owns user-facing presentation.

It MUST:

- subscribe before starting the first sub-agent so early events are not lost;
- keep the subscription alive until a terminal job event is observed or the job is explicitly abandoned;
- actively surface `visibility: user` milestones instead of waiting for the user to ask for status;
- when the current orchestrator itself publishes a `visibility: user` event, immediately render that event's human-readable `message` before making any subsequent tool call; do not wait for the event to return through the bus;
- turn structured events into concise natural language rather than dumping raw JSON;
- always surface `blocked`, `failed`, and terminal events immediately;
- explicitly surface `phone.released` so the user knows the phone can be used again;
- deduplicate by `event_id`;
- preserve ordering by `timestamp` within a task when practical;
- continue to show status even when the sub-agent is a background process.

It MUST NOT:

- claim progress that was not observed;
- infer success from process exit alone when the task has a domain-level success signal;
- wait for a follow-up user message before reporting an already-observed important milestone.

### Supplemental rich UI

An orchestrator may render an events-bus job snapshot through `events__progress` when the host supports MCP Apps UI resources. This is an enhancement, not the delivery contract. `visibility:user` events still require ordinary assistant-visible progress messages, and the render-before-next-tool-call barrier still applies.

## Sub-agent contract

A sub-agent MUST:

- receive `job_id` from its caller; never create a replacement job ID for the same orchestrated job;
- for a sandboxed Codex worker, use MCP `events__publish` rather than opening a direct NATS connection; direct localhost TCP may be denied by the sandbox;
- use the caller-provided exact literal `job_id` and `task_id` in every publish call; never substitute placeholders such as `inherited`, `current`, or `<job-id>`;
- for a direct non-sandbox local worker, `NEO_EVENTS_EMIT` may be used; never guess a repository-relative events-bus path;
- publish truthful events for its own work;
- include a short `message` understandable without reading logs;
- emit a terminal event exactly once for its task;
- never put credentials, cookies, tokens, private prompts, or large payloads into events.

A nested sub-agent uses the same `job_id`, a new `task_id`, and the caller's task ID as `parent_task_id`.

## Failure behavior

If the event transport is unavailable, the task may continue only if progress reporting is not safety-critical. The sub-agent must write the same event JSON to stderr/stdout as a fallback and clearly report the transport failure. The orchestrator should attempt transport recovery and may fall back to process log streaming.

Terminal business state and event delivery state are separate: a publish can succeed even if one progress event was lost. Do not convert one into the other.

## Security and scope

The default local NATS server binds to loopback only. Do not expose it publicly without authentication and network policy. Event payloads are metadata, not a place for secrets or full media/content blobs.
