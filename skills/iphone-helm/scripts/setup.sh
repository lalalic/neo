#!/bin/sh
# Self-contained engine installation (does not install or upgrade App Actions).
set -eu
BASE="${IPHONE_HELM_HOME:-$HOME/.local/iphone-helm}"
ENGINE="$BASE/engine"
BIN="$HOME/.local/bin/iphone-helm"
REPO="${IPHONE_HELM_ENGINE_REPO:-https://github.com/lalalic/iphone-helm.git}"
mkdir -p "$BASE" "$(dirname "$BIN")"
if [ -e "$ENGINE" ]; then
  test -d "$ENGINE/.git" || { echo 'Engine directory exists but is not a Git checkout; refusing overwrite' >&2; exit 1; }
  echo 'Engine already installed; use upgrade-engine.sh for upgrades.'
else
  git clone --depth 1 --branch main "$REPO" "$ENGINE"
fi
TARGET="$ENGINE/cli/bin/iphone-helm.mjs"
test -f "$TARGET" || { echo "CLI missing: $TARGET" >&2; exit 1; }
if [ -e "$BIN" ] || [ -L "$BIN" ]; then
  CURRENT=$(readlink "$BIN" 2>/dev/null || true)
  test "$CURRENT" = "$TARGET" || { echo "Another CLI owns $BIN; refusing replacement" >&2; exit 1; }
else
  ln -s "$TARGET" "$BIN"
fi
chmod +x "$TARGET"
"$BIN" --help | head -16
printf 'iPhoneHelm engine installed (App Actions are managed separately).\n'
