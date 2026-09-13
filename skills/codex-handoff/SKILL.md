---
name: codex-handoff
description: Hand work between ChatGPT and a local Codex worker through a Google Drive task queue, including iterative review/revision on the same work item, durable Codex thread continuation, and resource-scoped parallel execution.
---

# Codex handoff skill

Use this skill for creating, executing, checking, reviewing, or continuing unattended Google Drive handoff work.

## Core model

A handoff task is a long-lived work item, not necessarily a one-shot execution. The same Task ID and task directory may cycle through implementation, review, revision, and re-review until accepted or abandoned.

- `Task ID` is the stable identity of the work item and its response package.
- `HANDOFF.md` is authoritative for intent, target, constraints, and requested return material.
- Review feedback is appended to the same work item instead of creating a new unrelated task.
- The task directory remains the two-way communication envelope throughout the lifecycle.

## Lifecycle and state

- Inspect only the configured handoff `inbox` and claim eligible work atomically by moving the whole task directory to `processing`.
- A newly created work item starts as `NEW`; a revision returned after review starts as `REVISION_REQUESTED`. Both are executable states.
- When claimed, set `STATE` to `RUNNING`.
- When implementation or revision is complete and review is required, write/update `STATUS.md`, set `STATE` to `REVIEW`, release execution locks, and move the whole task directory to `done`.
- If review requests changes, append a timestamped review entry to `REVIEW.md`, set `STATE` to `REVISION_REQUESTED`, and move the same task directory back to `inbox`.
- If review accepts the result, set `STATE` to `ACCEPTED`; no further worker execution is required.
- Failures use `FAILED`, preserve diagnostics and useful partial outputs, and move the package to `failed`.
- Never hold an execution lock while waiting for human/ChatGPT review.

## Durable Codex continuation

- `Persistent thread: no` remains the default for one-shot work.
- `Persistent thread: yes` means all execution rounds of the same work item should continue in the same durable Codex thread whenever possible.
- Record the exact Codex thread/session ID in the task package, preferably in `THREAD_ID` and `STATUS.md`.
- A later `REVISION_REQUESTED` round must resume that recorded thread rather than start a new one.
- `Task name` is a human-readable workstream name; the recorded thread ID is authoritative once established.
- If a recorded thread cannot be resumed, record the failure explicitly before falling back to a new thread.

## Resource-scoped parallel execution

Do not serialize all handoff work behind one global worker lock. Scheduling is based on the target resource.

- Default lock scope is the task workspace, normally the normalized logical path corresponding to the Codex CLI `cwd`.
- Different workspaces may run concurrently, including different folders in the same monorepo.
- Tasks with the same workspace lock are serialized.
- A task that may modify repo-level/shared files can explicitly require a repo lock. A repo lock conflicts with every workspace lock inside that repo, and vice versa.
- Normalize lock keys so equivalent paths resolve to the same resource.
- Acquire the resource lock only for active execution and release it before `REVIEW`, `ACCEPTED`, or another waiting state.
- The worker pool must have multiple execution slots for resource locks to provide real concurrency.

## Git-backed return model

- Google Drive is the control plane; Git/GitHub is the code-review data plane.
- Git-backed tasks use a deterministic task branch for the lifetime of the Task ID, commit only task-related changes, and push that branch unless `HANDOFF.md` opts out.
- `STATUS.md` records repository, branch, base commit, head commit, cumulative review range, revision range, validation, and risks.
- Do not copy repository source files into the Drive package for ordinary Git-backed reviews. Keep control files such as `HANDOFF.md`, `STATE`, `STATUS.md`, `REVIEW.md`, and `THREAD_ID`.
- Never merge, force-push, rewrite shared history, or modify main/master directly.

## Target and repository safety

- Resolve exactly one target mode: repository by identity/origin, workspace-relative folder, or explicitly declared environment task. Reject ambiguity and record the diagnostic.
- Preserve unrelated changes. Record branch and pre-change SHA when applicable. Avoid main/master unless explicitly permitted. Never commit or push unless authorized.

## Bidirectional task package

- The creator places `HANDOFF.md`, executable `STATE`, and optional input assets in the task directory under `inbox`.
- Move the whole directory through lifecycle folders; do not reconstruct or fork the package for ordinary review/revision rounds.
- Write returned artifacts directly into the same task directory.
- Every completed worker round gets an auditable `STATUS.md`; for multiple files, prefer `RETURN_INDEX.md`.
- Do not overwrite/delete `HANDOFF.md` or request assets, and never copy secrets or private environment values into returned files.

## Notifications

- iMessage is a notification channel, not task state. Send `STARTED`, `REVIEW`, `DONE`/`ACCEPTED`, or `FAILED` as appropriate.
- The recipient comes only from the worker's local `CODEX_HANDOFF_IMESSAGE_RECIPIENT` environment variable.
- Notification failure must not change task state.

## Source and distribution

The maintained source lives under `neo/skills/codex-handoff`; `~/.codex` is an installed runtime copy and Google Drive is the queue/registry/distribution layer.
