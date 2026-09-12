#!/bin/zsh
set -u

STATE_DIR="${CODEX_HANDOFF_STATE_DIR:-/Users/chengli/.codex/handoff-state}"
MAP_FILE="$STATE_DIR/threads.tsv"
hash_name() { print -rn -- "$1" | shasum -a 256 | awk '{print $1}'; }
ensure_state() { mkdir -p "$STATE_DIR/locks"; touch "$MAP_FILE"; }
lookup_thread() { local key="$(hash_name "$1")"; awk -F '\t' -v key="$key" '$1 == key { print $3; exit }' "$MAP_FILE"; }
store_thread() {
  local name="$1" thread="$2" key="$(hash_name "$1")" tmp
  tmp="$(mktemp "$STATE_DIR/threads.XXXXXX")" || return 1
  awk -F '\t' -v key="$key" '$1 != key' "$MAP_FILE" > "$tmp"
  print -r -- "$key"$'\t'"$name"$'\t'"$thread" >> "$tmp"
  mv "$tmp" "$MAP_FILE"
}
lock_name() {
  local lock="$STATE_DIR/locks/$(hash_name "$1").lock"
  if ! mkdir "$lock" 2>/dev/null; then print -u2 -- "persistent task name is already running: $1"; return 1; fi
  print -r -- "$lock"
}
ensure_state
case "${1:-}" in
  lookup) lookup_thread "${2:?task name required}" ;;
  store) store_thread "${2:?task name required}" "${3:?thread id required}" ;;
  lock) lock_name "${2:?task name required}" ;;
  *) print -u2 -- "usage: $0 lookup|store|lock NAME [THREAD_ID]"; exit 2 ;;
esac
