#!/bin/zsh
set -e

SCRIPT="$(cd "$(dirname "$0")" && pwd)/../worker/resource_lock.sh"
STATE="$(mktemp -d -t handoff-resource-state)"
export CODEX_HANDOFF_STATE_DIR="$STATE"
trap 'rm -rf "$STATE"' EXIT

blocked() {
  "$SCRIPT" acquire "$@" >/dev/null 2>&1 &
  local pid=$!
  sleep 1
  if ! kill -0 "$pid" 2>/dev/null; then wait "$pid"; return 1; fi
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

one="$("$SCRIPT" acquire workspace neo/vlog neo $$)"
two="$("$SCRIPT" acquire workspace neo/other neo $$)"
[[ -d "$one" && -d "$two" ]]
blocked workspace neo/vlog neo 999993
blocked repo neo neo 999994

"$SCRIPT" release "$one"
"$SCRIPT" release "$two"
repo_lock="$("$SCRIPT" acquire repo neo neo $$)"
blocked workspace neo/vlog neo 999996
"$SCRIPT" release "$repo_lock"

print 'resource lock tests passed'
