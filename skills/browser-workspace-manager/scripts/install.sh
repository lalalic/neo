#!/bin/sh
set -eu

SKILL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
TARGET_DIR="${BH_AGENT_WORKSPACE:-$HOME/.config/browser-harness/agent-workspace}"
ENV_FILE="$TARGET_DIR/.env"
DEPLOY_ROOT="${BH_WORKSPACE_MANAGER_HOME:-$HOME/.config/browser-workspace-manager}"
EXTENSION_DIR="$DEPLOY_ROOT/extension"
EXTENSION_ID="kgbghhigmbpefppgkocgjgnnnbhjchic"
WORKSPACE_NAME="${BH_WORKSPACE_NAME:-MDB}"
POOL_SIZE="${BH_WORKSPACE_POOL_SIZE:-8}"

mkdir -p "$TARGET_DIR" "$DEPLOY_ROOT"
cp "$SKILL_DIR/browser-harness/agent_helpers.py" "$TARGET_DIR/agent_helpers.py"
rm -rf "$EXTENSION_DIR"
cp -R "$SKILL_DIR/extension" "$EXTENSION_DIR"

python3 - "$ENV_FILE" "$EXTENSION_ID" "$WORKSPACE_NAME" "$POOL_SIZE" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
values = {
    "BH_WORKSPACE_MANAGER_EXTENSION_ID": sys.argv[2],
    "BH_WORKSPACE_NAME": sys.argv[3],
    "BH_WORKSPACE_POOL_SIZE": sys.argv[4],
}
lines = path.read_text().splitlines() if path.exists() else []
kept = [line for line in lines if not any(line.startswith(f"{key}=") for key in values)]
kept.extend(f"{key}={value}" for key, value in values.items())
path.write_text("\n".join(kept) + "\n")
PY

echo "Browser Harness helper installed."
echo "Chrome extension directory: $EXTENSION_DIR"
echo "Extension ID: $EXTENSION_ID"
echo "Workspace: $WORKSPACE_NAME (pool size $POOL_SIZE)"
