# Codex handoff skill

Use this skill for the unattended Google Drive handoff worker.

- Inspect only the inbox under the configured handoff root and process at most
  one task whose STATE is exactly NEW.
- Atomically move the task directory to processing, then set STATE to RUNNING.
  Read HANDOFF.md completely; it is authoritative.
- Resolve exactly one target mode: a repository target by identity/origin, a
  workspace-relative folder target, or an explicitly declared environment task.
  Reject ambiguous modes and record the diagnostic.
- Preserve unrelated changes, record branch and pre-change SHA when applicable,
  avoid main/master unless explicitly permitted, and never commit or push unless
  authorized.
- Send an unconditional local iMessage notification when a task is claimed
  (`STARTED`) and after finalization (`DONE` or `FAILED`). Notification settings
  in HANDOFF.md are ignored; the recipient comes only from the worker's local
  `CODEX_HANDOFF_IMESSAGE_RECIPIENT` environment variable.
- Write an auditable STATUS.md, persist terminal STATE, and move the task to done
  or failed. Terminal notification delivery failures must not change task state.

The canonical source is neo/skills; ~/.codex is an installed runtime copy and
Drive is the queue/registry/distribution layer.

Handoff metadata supports opt-in persistent continuation:

- `Persistent thread: no` is the default and preserves one-shot execution.
- `Persistent thread: yes` requires a non-empty `Task name`.
- The same `Task name` resumes the same durable Codex thread; different names
  are separate workstreams and are serialized independently.
- `Task ID` remains the unique handoff handle and lifecycle identity. Status
  queries continue to use Task ID, while Task name identifies the logical
  persistent workstream.
