# Neo orchestrator control plane

`/Users/chengli/Workspace/neo/.run` is the private, ignored control plane for top-level orchestration. It stores pointers and observed orchestration state only. It does not replace `MISSION.md`, project `runs/` directories, GitHub workflow state, events-bus records, worker state, or generated artifacts. GitHub remains authoritative for GitHub-backed coding work: its PR state, head SHA, checks, reviews, comments, and merge result determine the durable workflow.

## V1 layout

```text
neo/.run/
├── state.json
└── pointers/
```

Use `state.json` for portfolio state and a small file under `pointers/` only when a pointer is too useful to inline. Keep secrets, user prompts, media, logs, and execution content out of `.run`.

```json
{
  "schema_version": 1,
  "updated_at": "2026-09-17T10:00:00Z",
  "objective": {
    "id": "portfolio-objective",
    "text": "Portfolio objective",
    "status": "active",
    "refs": ["mission:/Users/chengli/Workspace/neo/MISSION.md"]
  },
  "tasks": [
    {
      "id": "task-id",
      "status": "todo|running|blocked|done|failed|cancelled",
      "project": "project-name",
      "owner": "agent-or-person",
      "worker": {"kind": "codex", "thread_id": "optional", "profile": "optional"},
      "depends_on": ["prerequisite-task-id"],
      "refs": ["github:owner/name#1", "events:job-id"],
      "last_observed_state": "Short factual summary",
      "next_action": "Concrete next action",
      "requires_user": false
    }
  ],
  "handoffs": [
    {
      "at": "2026-09-17T10:00:00Z",
      "task_id": "task-id",
      "owner": "agent-or-person",
      "project": "project-name",
      "worker": {"kind": "codex", "thread_id": "optional", "profile": "optional"},
      "refs": ["github:owner/name#1", "events:job-id", "artifact:project/runs/date/path"],
      "last_observed_state": "Short factual summary",
      "next_action": "Concrete next action",
      "requires_user": false
    }
  ]
}
```

The schema is intentionally permissive except for `schema_version`, `updated_at`, IDs, statuses, refs, `last_observed_state`, `next_action`, and `requires_user`. An omitted worker is unknown, not inferred. Refs must be resolvable and should include a type prefix.

## Heartbeat decision loop

An external hourly heartbeat invokes the orchestrator; it must not create a daemon, database, or scheduler. For each heartbeat:

1. Read `.run/state.json`; ignore control-plane content if it is missing, unreadable, or has an unsupported schema, then surface the problem.
2. Reconcile before acting: verify each relevant task against its GitHub, events-bus, worker, and artifact references. Never overwrite authoritative state; update only `.run` observations and pointers.
3. Select the highest-priority task whose `depends_on` tasks are all `done`. Treat unknown, blocked, failed, cancelled, or unresolvable prerequisites as not ready.
4. Execute only a bounded, explicitly authorized next action that is safe to resume.
5. Record the observed result, current owner/project/worker, authoritative refs, next action, and `requires_user` before returning.

Stop and leave `requires_user: true` when authorization is missing, state conflicts with authoritative sources, an objective or dependency is ambiguous, validation fails, a worker cannot be reconciled, or the next action is destructive, financial, publishing, commitment-making, or otherwise consequential without explicit permission. Also stop when there is no resolvable action; do not infer one from the mission goal.
