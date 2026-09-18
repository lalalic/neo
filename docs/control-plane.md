# Neo orchestrator control plane

`/Users/chengli/Workspace/neo/.run` is the private, ignored control plane for top-level orchestration. Its core loop is **Plan → Task → Review**: review the durable plan, decompose it into owned tasks, execute and reconcile them, then feed evidence back into the next plan review. It stores strategy, current portfolio state, task handoffs, and review/decision history only. It does not replace `MISSION.md`, project `runs/` directories, GitHub workflow state, events-bus records, worker state, or generated artifacts. GitHub remains authoritative for GitHub-backed coding work: its PR state, head SHA, checks, reviews, comments, and merge result determine the durable workflow. Mission and plan state goals and priorities; neither authorizes spending, publishing, merging, external commitments, or claiming earnings.

## V1 layout

```text
neo/.run/
├── PLAN.md
├── state.json
├── tasks/<task-id>.json
└── heartbeats/<YYYY-MM-DD>.jsonl
```

`PLAN.md` is durable portfolio strategy: workstreams, phases, gates, priorities, assumptions, and review policy. `state.json` is the current portfolio index. `tasks/` holds execution and durable handoff records. `heartbeats/` holds plan-review and orchestration-decision history. Keep secrets, user prompts, media, logs, and execution content out of `.run`.

```json
{
  "schema_version": 1,
  "orchestrator_id": "xchat",
  "mission_ref": "MISSION.md",
  "plan_ref": ".run/PLAN.md",
  "status": "active",
  "active_phase": "phase-id",
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
  "last_strategic_review_at": null,
  "updated_at": "2026-09-17T10:00:00Z"
}
```

```json
{
  "schema_version": 1,
  "task_id": "task-id",
  "objective_id": "objective-id",
  "plan_phase": "phase-id",
  "workstream": "W0",
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

Omit optional fields rather than inventing values. A missing worker identity remains unknown; `depends_on`, `plan_phase`, and `workstream` are optional, although delegated work should normally include plan and workstream bindings. `authoritative_refs` must identify resolvable sources such as GitHub PRs or commits, events-bus jobs, worker threads, and observable artifacts. Keep `handoff` focused on binding and ownership; do not put media, prompts, credentials, logs, or large outputs in it.

After each heartbeat run, append one JSON object per line to the UTC-date heartbeat file. Keep the record short:

```json
{"at": "2026-09-17T10:00:00Z", "task_id": "task-id", "review_type": "lightweight|strategic", "decision": "acted|waited|blocked|escalated|replanned", "reason": "Short factual reason", "plan_review": "Short plan conclusion or 'no material plan change'", "next_action": "Concrete next action", "requires_user": false}
```

## Heartbeat decision loop

An external hourly heartbeat invokes the orchestrator; it must not create a daemon, database, or scheduler. Each heartbeat starts with a lightweight plan review before selecting or delegating a task:

1. Read `MISSION.md` and `PLAN.md`. Review mission/user changes, invalid assumptions, the active phase gate or bottleneck, active-task alignment, dependency/priority changes, and whether to stop, split, reprioritize, or reroute work.
2. Read `state.json` and every referenced task file; surface unsupported, unreadable, or missing records instead of improvising around them.
3. Reconcile before acting: verify each relevant task against its authoritative GitHub, events-bus, worker, and artifact references. Never overwrite authoritative state; update only `.run` observations and handoffs.
4. Select the highest-priority task whose `depends_on` tasks are all `done` and whose plan phase/workstream remains current. Treat unknown, blocked, failed, cancelled, or unresolvable prerequisites as not ready.
5. Execute only a bounded, explicitly authorized next action that is safe to resume.
6. Update `state.json` and the relevant task file with the observed result, owner/project/worker, authoritative refs, next action, and `requires_user`; set `last_heartbeat_at` and `updated_at`.
7. Append exactly one concise review/decision record to `heartbeats/<UTC-date>.jsonl`, including a run that waited, found nothing safe, or encountered an error.

Run a full strategic review at least every 24 hours and immediately after a phase gate, major experiment result, material opportunity, repeated quality failure, or user priority change. A material strategy change updates `PLAN.md`; ordinary task progress updates only state and task files. Record `review_type: strategic`, update `last_strategic_review_at`, and summarize the resulting plan decision.

Stop and leave `requires_user: true` when authorization is missing, state conflicts with authoritative sources, an objective or dependency is ambiguous, validation fails, a worker cannot be reconciled, or the next action is destructive, financial, publishing, merging, an external commitment, or otherwise consequential without explicit permission. Also stop when there is no resolvable action; do not infer one from the mission or plan goal.
