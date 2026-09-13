#!/bin/zsh
set -e

SCRIPT="$(cd "$(dirname "$0")" && pwd)/../worker/persistent_dispatch.sh"
STATE="$(mktemp -d -t handoff-persistent-state)"
export CODEX_HANDOFF_STATE_DIR="$STATE"

[[ -z "$($SCRIPT lookup missing)" ]]
$SCRIPT store alpha thread-1
[[ "$($SCRIPT lookup alpha)" == thread-1 ]]
! $SCRIPT store alpha thread-2 >/dev/null 2>&1
[[ "$($SCRIPT lookup alpha)" == thread-1 ]]
$SCRIPT store beta thread-3
[[ "$($SCRIPT lookup beta)" == thread-3 ]]
LOCK="$($SCRIPT lock alpha)"
! $SCRIPT lock alpha >/dev/null 2>&1
rmdir "$LOCK"

print 'persistent dispatch tests passed'
