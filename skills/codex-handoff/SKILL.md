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
- Write an auditable STATUS.md, persist terminal STATE, move the task to done or
  failed, verify the final parent/state, and only then send the configured local
  iMessage notification.

The canonical source is neo/skills; ~/.codex is an installed runtime copy and
Drive is the queue/registry/distribution layer.
