#!/bin/zsh
set -u

# Local-only configuration. The recipient is intentionally never read from or
# written to a Drive task, source tree, STATUS.md, or notification log.
LOG_PATH="${CODEX_HANDOFF_NOTIFICATION_LOG:-/Users/chengli/.codex/handoff-notification.log}"

usage() {
  print "usage: $0 render --event started|done|failed --task HANDLE [--summary TEXT]"
  print "       $0 notify --notification imessage|none --events LIST --event started|done|failed --task HANDLE [--summary TEXT]"
  print "       $0 should-notify --notification imessage|none --events LIST --event started|done|failed"
}

recipient() {
  print -r -- "${CODEX_HANDOFF_IMESSAGE_RECIPIENT:-}"
}

has_event() {
  local wanted="$1" list="$2" item
  wanted="${wanted:l}"
  while IFS= read -r item; do
    [[ "${item:l}" == "$wanted" ]] && return 0
  done < <(print -r -- "$list" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
  return 1
}

message_for() {
  local event="${1:l}" task="$2" summary="${3:-}"
  local prefix="❌ Neo Handoff FAILED"
  [[ "$event" == started ]] && prefix="🚀 Neo Handoff STARTED"
  [[ "$event" == done ]] && prefix="✅ Neo Handoff DONE"
  if [[ -n "$summary" ]]; then
    print -r -- "$prefix — $task — $summary"
  else
    print -r -- "$prefix — $task"
  fi
}

should_notify() {
  local notification="${1:l}" events="$2" event="${3:l}"
  [[ "$notification" == imessage ]] || return 1
  [[ -n "$events" ]] || events="done,failed"
  has_event "$event" "$events"
}

write_log() {
  local line="$1"
  mkdir -p "${LOG_PATH:h}"
  print -r -- "$(date -u +%Y-%m-%dT%H:%M:%SZ) $line" >> "$LOG_PATH"
}

send_imessage() {
  local to="$1" text="$2"
  osascript - "$to" "$text" <<'APPLESCRIPT'
on run argv
  set recipientAddress to item 1 of argv
  set messageText to item 2 of argv
  tell application "Messages"
    set targetService to first service whose service type is iMessage
    set targetBuddy to buddy recipientAddress of targetService
    send messageText to targetBuddy
  end tell
end run
APPLESCRIPT
}

command="${1:-}"
shift 2>/dev/null || true
notification="none" events="" event="" task="" summary="" dry_run=0
while (( $# )); do
  case "$1" in
    --notification) notification="${2:-none}"; shift 2 ;;
    --events) events="${2:-}"; shift 2 ;;
    --event) event="${2:-}"; shift 2 ;;
    --task) task="${2:-}"; shift 2 ;;
    --summary) summary="${2:-}"; shift 2 ;;
    --dry-run) dry_run=1; shift ;;
    *) usage >&2; exit 2 ;;
  esac
done

case "$command" in
  render)
    [[ "$event" == started || "$event" == done || "$event" == failed ]] && [[ -n "$task" ]] || { usage >&2; exit 2; }
    message_for "$event" "$task" "$summary"
    ;;
  should-notify)
    should_notify "$notification" "$events" "$event"
    ;;
  notify)
    [[ "$event" == started || "$event" == done || "$event" == failed ]] && [[ -n "$task" ]] || { usage >&2; exit 2; }
    if ! should_notify "$notification" "$events" "$event"; then exit 0; fi
    message="$(message_for "$event" "$task" "$summary")"
    if (( dry_run )); then print -r -- "$message"; exit 0; fi
    to="$(recipient)"
    if [[ -z "$to" ]]; then
      write_log "delivery_skipped event=$event task=$task reason=recipient_not_configured"
      exit 0
    fi
    if send_imessage "$to" "$message"; then
      write_log "delivery_succeeded event=$event task=$task"
    else
      write_log "delivery_failed event=$event task=$task"
      exit 1
    fi
    ;;
  *) usage >&2; exit 2 ;;
esac
