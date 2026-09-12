#!/bin/zsh
set -u
set -e

SCRIPT="$(cd "$(dirname "$0")" && pwd)/../worker/handoff_notification.sh"
TMP_CONFIG="$(mktemp -t handoff-notification-config).env"
TMP_LOG="$(mktemp -t handoff-notification-log)"
TMP_BIN="$(mktemp -d -t handoff-notification-bin)"
TMP_RECIPIENT="$(mktemp -t handoff-notification-recipient)"
trap 'rm -f "$TMP_CONFIG" "$TMP_LOG" "$TMP_RECIPIENT"; rm -rf "$TMP_BIN"' EXIT

print 'CODEX_HANDOFF_IMESSAGE_RECIPIENT=local-test-alias' > "$TMP_CONFIG"

[[ "$("$SCRIPT" render --event done --task task-123 --summary 'all good')" == '✅ Neo Handoff DONE — task-123 — all good' ]]
[[ "$("$SCRIPT" render --event failed --task task-123)" == '❌ Neo Handoff FAILED — task-123' ]]
[[ "$($SCRIPT render --event started --task task-123)" == '🚀 Neo Handoff STARTED — task-123' ]]
"$SCRIPT" should-notify --notification imessage --events started,done,failed --event started
"$SCRIPT" should-notify --notification imessage --events done,failed --event done
! "$SCRIPT" should-notify --notification imessage --events done --event failed
! "$SCRIPT" should-notify --notification none --events done,failed --event done
[[ "$(CODEX_HANDOFF_CONFIG="$TMP_CONFIG" CODEX_HANDOFF_NOTIFICATION_LOG="$TMP_LOG" "$SCRIPT" notify --notification imessage --events done,failed --event failed --task task-123 --summary error --dry-run)" == '❌ Neo Handoff FAILED — task-123 — error' ]]
! rg -q 'local-test-alias' "$TMP_LOG"

cat > "$TMP_BIN/osascript" <<'FAKE_OSASCRIPT'
#!/bin/zsh
print -r -- "$2" > "${TEST_RECIPIENT_FILE:?}"
FAKE_OSASCRIPT
chmod +x "$TMP_BIN/osascript"
PATH="$TMP_BIN:$PATH" TEST_RECIPIENT_FILE="$TMP_RECIPIENT" CODEX_HANDOFF_CONFIG="$TMP_CONFIG" CODEX_HANDOFF_IMESSAGE_RECIPIENT='process-env-recipient' CODEX_HANDOFF_NOTIFICATION_LOG="$TMP_LOG" "$SCRIPT" notify --notification imessage --events done --event done --task task-123 --summary smoke
[[ "$(<"$TMP_RECIPIENT")" == 'process-env-recipient' ]]
! rg -q 'local-test-alias' "$TMP_RECIPIENT"

print 'handoff notification tests passed'
