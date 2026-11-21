#!/bin/sh
# Launch existing real-device capture/Markcut workflow from installed engine.
# Caller supplies --mcp, --token-file, --plan, --app, --output-dir and render flags.
set -eu
ENGINE="${IPHONE_HELM_HOME:-$HOME/.local/iphone-helm}/engine"
test -f "$ENGINE/scripts/demo-session.py" || { echo 'Engine not installed; run setup.sh' >&2; exit 1; }
exec python3 "$ENGINE/scripts/demo-session.py" capture "$@"
