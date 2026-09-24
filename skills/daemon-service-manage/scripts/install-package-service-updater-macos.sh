#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NEO_SKILLS_DIR="$(cd "$SKILL_DIR/.." && pwd)"
NODE="$(command -v node)"
NPM="$(command -v npm)"
NPX="$(command -v npx)"
PM2_NAME="neo-package-service-updater"
LEGACY_LABEL="com.neo.package-service-updater"
LEGACY_PLIST="$HOME/Library/LaunchAgents/$LEGACY_LABEL.plist"
STATE_DIR="$HOME/.neo"
RUNTIME="$STATE_DIR/package-service-updater/runtime"
TMP="$STATE_DIR/package-service-updater/runtime.tmp.$$"
NATS_URL="${NEO_NATS_URL:-nats://127.0.0.1:4222}"

mkdir -p "$STATE_DIR/package-service-updater"
chmod 700 "$STATE_DIR" "$STATE_DIR/package-service-updater"

rm -rf "$TMP"
mkdir -p "$TMP/skills/daemon-service-manage/scripts" "$TMP/skills/events-bus"
cp "$SCRIPT_DIR/package-service-updater.mjs" "$TMP/skills/daemon-service-manage/scripts/"
cp -R "$NEO_SKILLS_DIR/events-bus/transport" "$TMP/skills/events-bus/"
cp "$NEO_SKILLS_DIR/events-bus/package.json" "$NEO_SKILLS_DIR/events-bus/package-lock.json" "$TMP/skills/events-bus/"
"$NPM" ci --omit=dev --prefix "$TMP/skills/events-bus" >/dev/null
rm -rf "$RUNTIME"
mv "$TMP" "$RUNTIME"

UPDATER="$RUNTIME/skills/daemon-service-manage/scripts/package-service-updater.mjs"

# Remove legacy LaunchAgent ownership if present.
launchctl bootout "gui/$(id -u)/$LEGACY_LABEL" >/dev/null 2>&1 || true
rm -f "$LEGACY_PLIST"

# Refresh only this PM2 process. Never stop/restart the PM2 daemon.
"$NPX" pm2 delete "$PM2_NAME" >/dev/null 2>&1 || true
NEO_NATS_URL="$NATS_URL" "$NPX" pm2 start "$UPDATER"   --name "$PM2_NAME"   --interpreter "$NODE"   --cwd "$HOME"   --time >/dev/null
"$NPX" pm2 save >/dev/null

echo "installed $PM2_NAME at $RUNTIME"
