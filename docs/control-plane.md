# Neo orchestrator control plane

`/Users/chengli/Workspace/neo/.run` is the private, ignored control plane for top-level orchestration. It stores portfolio state, task handoffs, and heartbeat decisions only. It does not replace `MISSION.md`, project `runs/` directories, GitHub workflow state, events-bus records, worker state, or generated artifacts. GitHub remains authoritative for GitHub-backed coding work: its PR state, head SHA, checks, reviews, comments, and merge result determine the durable workflow.

## V1 layout

```text
neo/.run/
├── state.json
├── tasks/<task-id>.json
└── heartbeats/<YYYY-MM-DD>.jsonl
```

`state.json` is the index for mission-level objectives and active task IDs. `tasks/` holds one durable handoff per task. `heartbeats/` holds one concise decision record per orchestration run. Keep secrets, user prompts, media, logs, and execution content out of `.run`.

```json
{
  "schema_version": 1,
  "orchestrator_id": "xchat",
  "mission_ref": "MISSION.md",
  "status": "active",
  "active_objectives": [
    {
      "objective_id": "objective-id",
      "goal": "Portfolio objective",
      "status": "queued|implementing|active|done|blocked",
      "success": "Observable completion condition"
    }
  ],
  "active_tasks": ["task-id"],
  "next_action": "Concrete portfolio-level next action",
  "last_heartbeat_at": null,
  "updated_at": "2026-09-17T10:00:00Z"
}
```

```json
{
  "schema_version": 1,
  "task_id": "task-id",
  "objective_id": "objective-id",
  "project": "project-name",
  "status": "queued|running|changes_requested|blocked|done|failed|cancelled",
  "owner": "agent-or-person",
  "depends_on": ["prerequisite-task-id"],
  "handoff": {
    "worker_kind": "codex",
    "worker_job": "worker-job-id",
    "worktree": "/absolute/path/to/worktree",
    "branch": "task/branch-name",
    "profile": "configured-profile",
    "provider": "provider-name",
    "model": "model-name-or-unknown",
    "thinking_effort": "configured-thinking-level",
    "thread_id": "persistent-thread-id"
  },
  "authoritative_refs": {
    "job_id": "events-job-id",
    "git_repo": "owner/name",
    "commit_sha": "full-or-known-commit-sha"
  },
  "last_observed": "Short factual summary",
  "next_action": "Concrete next action",
  "requires_user": false,
  "updated_at": "2026-09-17T10:00:00Z"
}
```

Omit optional fields rather than inventing values. A missing worker identity remains unknown; `depends_on` is optional. `authoritative_refs` must identify resolvable sources such as GitHub PRs or commits, events-bus jobs, worker threads, and observable artifacts. Keep `handoff` focused on binding and ownership; do not put media, prompts, credentials, logs, or large outputs in it.

After each heartbeat run, append one JSON object per line to the UTC-date heartbeat file. Keep the record short:

```json
{"at": "2026-09-17T10:00:00Z", "task_id": "task-id", "decision": "acted|waited|blocked|escalated", "reason": "Short factual reason", "next_action": "Concrete next action", "requires_user": false}
```

## Heartbeat decision loop

An external hourly heartbeat invokes the orchestrator; it must not create a daemon, database, or scheduler. For each heartbeat:

1. Read `state.json` and every referenced task file; surface unsupported, unreadable, or missing records instead of improvising around them.
2. Reconcile before acting: verify each relevant task against its authoritative GitHub, events-bus, worker, and artifact references. Never overwrite authoritative state; update only `.run` observations and handoffs.
3. Select the highest-priority task whose `depends_on` tasks are all `done`. Treat unknown, blocked, failed, cancelled, or unresolvable prerequisites as not ready.
4. Execute only a bounded, explicitly authorized next action that is safe to resume.
5. Update `state.json` and the relevant task file with the observed result, owner/project/worker, authoritative refs, next action, and `requires_user`; set `last_heartbeat_at` and `updated_at`.
6. Append exactly one concise decision record to `heartbeats/<UTC-date>.jsonl`, including a run that waited, found nothing safe, or encountered an error.

Stop and leave `requires_user: true` when authorization is missing, state conflicts with authoritative sources, an objective or dependency is ambiguous, validation fails, a worker cannot be reconciled, or the next action is destructive, financial, publishing, commitment-making, or otherwise consequential without explicit permission. Also stop when there is no resolvable action; do not infer one from the mission goal.
