#!/bin/sh
set -eu
CLI="${IPHONE_HELM_CLI:-$HOME/.local/bin/iphone-helm}"
test -x "$CLI" || { echo 'CLI missing; first run scripts/setup.sh' >&2; exit 1; }
"$CLI" actions install "$@"
"$CLI" actions status
printf 'App Actions installed independently of the engine.\n'
