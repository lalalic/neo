#!/bin/zsh
set -u

STATE_DIR="${CODEX_HANDOFF_STATE_DIR:-/Users/chengli/.codex/handoff-state}"
LOCK="$STATE_DIR/claim.lock"
mkdir -p "$STATE_DIR"
while ! mkdir "$LOCK" 2>/dev/null; do
  if [[ -f "$LOCK/pid" ]] && ! kill -0 "$(<"$LOCK/pid")" 2>/dev/null; then
    rm -rf "$LOCK"
    continue
  fi
  sleep 1
done
print -r -- "$$" > "$LOCK/pid"
print -r -- "$LOCK"
