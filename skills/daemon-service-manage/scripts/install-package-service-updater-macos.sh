#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UPDATER="$SCRIPT_DIR/package-service-updater.mjs"
NODE="$(command -v node)"
LABEL="com.neo.package-service-updater"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE_DIR="$HOME/.neo"
LOG="$STATE_DIR/package-service-updater.log"
ERR="$STATE_DIR/package-service-updater-error.log"

mkdir -p "$HOME/Library/LaunchAgents" "$STATE_DIR"
chmod 700 "$STATE_DIR"

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
echo "installed $LABEL"
