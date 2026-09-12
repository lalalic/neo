#!/bin/zsh
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export CODEX_HANDOFF_NOTIFICATION_SCRIPT="$SCRIPT_DIR/handoff_notification.sh"

while true; do
  "$SCRIPT_DIR/handoff_worker.sh" || true
  sleep 60
done
