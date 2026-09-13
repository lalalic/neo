# Codex handoff

The handoff skill defines a Drive-backed task lifecycle and a local worker pool
that executes at most one task per slot per run. Different workspaces may run
concurrently while conflicting workspace/repo resources remain serialized.
`SKILL.md` is the concise operating
contract; the bidirectional request/response file contract is in
`references/protocol.md`, with notification details in `references/notifications.md`.

Git-backed tasks return a pushed task branch and review commit range. Drive
stores the control package and status; GitHub is the source of truth for code
diffs.

## Requesting returned material

Put the requested output in the task's `HANDOFF.md`. The worker may add exact
source exports, generated artifacts, reports, diagnostics, or other context
files directly beside `HANDOFF.md` in the same task directory. For multiple
returned files, request or provide a `RETURN_INDEX.md` describing provenance,
copy/summary/generated status, and purpose. Do not include secrets or private
environment values.

When the task finishes, the complete directory moves to `done` or `failed`.
Consumers retrieve the authoritative response package by finding the `Task ID`
in that folder and reading its `STATUS.md` plus returned files. A separate
output location is exceptional and must be explicitly requested or justified
by artifact size/format, with a pointer recorded in `STATUS.md` or
`RETURN_INDEX.md`.

Persistent continuation is opt-in. Omitted metadata and `Persistent thread: no`
use one-shot behavior. With `Persistent thread: yes`, `Task name` is the stable
key for resuming a durable Codex thread; `Task ID` remains the unique lifecycle
handle.

## Local PM2 lifecycle

    node ./scripts/install-pm2.js
    npx pm2 status codex-handoff-worker
    npx pm2 logs codex-handoff-worker
    npx pm2 restart codex-handoff-worker
    npx pm2 stop codex-handoff-worker

The PM2 process inherits the existing environment, including the optional local-
only `CODEX_HANDOFF_IMESSAGE_RECIPIENT`. It does not store recipient values in
this tree.
