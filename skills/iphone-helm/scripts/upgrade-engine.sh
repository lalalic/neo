#!/bin/sh
set -eu
ENGINE="${IPHONE_HELM_HOME:-$HOME/.local/iphone-helm}/engine"
test -d "$ENGINE/.git" || { echo 'Engine not installed; run setup.sh' >&2; exit 1; }
test "$(git -C "$ENGINE" branch --show-current)" = 'main' || { echo 'Engine on non-main branch, refusing upgrade' >&2; exit 1; }
test -z "$(git -C "$ENGINE" status --porcelain)" || { echo 'Engine has dirty work, refusing upgrade' >&2; exit 1; }
git -C "$ENGINE" pull --ff-only origin main
printf 'Engine upgraded. App Actions unchanged.\n'
