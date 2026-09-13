# Notifications

The adapter is `node worker/handoff.js notification`. The worker sends `started`,
`review`, `done`, `accepted`, or `failed` as appropriate; HANDOFF.md
notification fields are ignored.
The recipient comes only from the inherited
CODEX_HANDOFF_IMESSAGE_RECIPIENT environment variable. Never write that
private value to Drive, Git, STATUS.md, or logs.

Send `started` after the task is claimed. After final Drive verification, call
the adapter with the terminal event, task handle, and a short summary. Delivery
failures are local diagnostics only.
