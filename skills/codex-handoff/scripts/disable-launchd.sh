#!/bin/zsh
set -eu

LABEL=com.chengli.codex-handoff-worker
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
print -r -- "$LABEL disabled; unrelated launchd jobs were not touched"
