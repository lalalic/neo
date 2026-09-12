# Notifications

The adapter is worker/handoff_notification.sh. Notification: imessage enables
it; none disables it. Empty events mean done,failed. worker-configured default
means the recipient comes only from the inherited
CODEX_HANDOFF_IMESSAGE_RECIPIENT environment variable. Never write that
private value to Drive, Git, STATUS.md, or logs.

After final Drive verification, call the adapter with the terminal event, task
handle, configured event list, and a short summary. If no recipient is
configured, use --dry-run and record that setup is required. Delivery failures
are local diagnostics only.
