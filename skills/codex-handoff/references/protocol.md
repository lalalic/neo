# Bidirectional handoff protocol

The task directory is one durable communication envelope in two directions. It
is both the request sent to Codex and the response package returned to the
ChatGPT/user.

## Request and claim

The creator puts `HANDOFF.md`, a `STATE` file containing exactly `NEW` or
`REVISION_REQUESTED`, and optional input assets in a task directory under
`inbox`. The worker claims the whole directory atomically by moving it to
`processing`, then immediately changes `STATE` to `RUNNING`.

## Execution and review

The worker follows the target, branch, write, and privacy rules in
`HANDOFF.md`. A completed implementation round writes `STATUS.md`, sets
`STATE=REVIEW`, releases execution locks, and moves the package to `done`.
Review feedback is appended to `REVIEW.md`; a revision sets
`STATE=REVISION_REQUESTED` and moves the same package back to `inbox`. An
accepted work item uses `STATE=ACCEPTED`. Failures use `STATE=FAILED` and keep
useful diagnostics in the same package.

Persistent tasks preserve the exact Codex thread/session ID in `THREAD_ID` and
`STATUS.md` where available. A revision resumes that ID. The human-readable
`Task name` is only the lookup key for the persistent workstream.

## Resource locks

Execution locks are scoped to the normalized logical workspace by default.
Different workspaces may run concurrently. Same-workspace tasks serialize.
Tasks that can modify shared repository files may request a repo lock; a repo
lock conflicts with every workspace lock inside that repo in either direction.
Locks are acquired only for active execution and are released before review or
another waiting state. Multiple worker slots are required for parallelism.

## Git-backed review return

For a Git-backed task, Drive carries lifecycle metadata and GitHub carries the
reviewable code. The worker uses one deterministic task branch, commits only
task-related changes, and pushes it before returning `REVIEW`. `STATUS.md` must
record the base and head commits, cumulative review range, revision-only range,
validation results, and persistent thread ID. Ordinary source files are not
copied into Drive; `RETURN_INDEX.md` is reserved for non-Git artifacts.

## Returned material and terminal response

Workers write result files directly into the processing task directory. They do
not overwrite `HANDOFF.md` or input assets and do not copy secrets or private
environment values into returned files. Multiple returned files should have a
`RETURN_INDEX.md` describing provenance and purpose.

Every completed round gets an auditable `STATUS.md` containing state, target,
repository/branch and pre-change SHA when relevant, files changed or inspected,
commands and validations, blockers/errors, and the thread ID. After the state
is persisted, the whole directory moves to `done` or `failed`, and the final
parent/state are verified before notification. Notification delivery failure
does not alter task state.
