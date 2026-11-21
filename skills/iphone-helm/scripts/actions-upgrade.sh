#!/bin/sh
set -eu
CLI="${IPHONE_HELM_CLI:-$HOME/.local/bin/iphone-helm}"
test -x "$CLI" || { echo 'CLI missing; first run scripts/setup.sh' >&2; exit 1; }
"$CLI" actions upgrade "$@"
"$CLI" actions status
printf 'App Actions upgraded; engine and iPhone Runner unchanged.\n'
