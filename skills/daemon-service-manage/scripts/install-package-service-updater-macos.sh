#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NEO_SKILLS_DIR="$(cd "$SKILL_DIR/.." && pwd)"
NODE="$(command -v node)"
NPM="$(command -v npm)"
LABEL="com.neo.package-service-updater"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE_DIR="$HOME/.neo"
RUNTIME="$STATE_DIR/package-service-updater/runtime"
TMP="$STATE_DIR/package-service-updater/runtime.tmp.$$"
LOG="$STATE_DIR/package-service-updater.log"
ERR="$STATE_DIR/package-service-updater-error.log"

mkdir -p "$HOME/Library/LaunchAgents" "$STATE_DIR/package-service-updater"
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

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$UPDATER</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$ERR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>NEO_NATS_URL</key><string>${NEO_NATS_URL:-nats://127.0.0.1:4222}</string>
  </dict>
</dict>
</plist>
EOF

plutil -lint "$PLIST" >/dev/null
launchctl bootout "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"
echo "installed $LABEL at $RUNTIME"
