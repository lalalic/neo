#!/bin/zsh
set -u

STATE_DIR="${CODEX_HANDOFF_STATE_DIR:-/Users/chengli/.codex/handoff-state}"
MAP_FILE="$STATE_DIR/threads.tsv"
INDEX_MUTEX="$STATE_DIR/threads.lock"
hash_name() { print -rn -- "$1" | shasum -a 256 | awk '{print $1}'; }
ensure_state() { mkdir -p "$STATE_DIR/locks"; touch "$MAP_FILE"; }
lookup_thread() { local key="$(hash_name "$1")"; awk -F '\t' -v key="$key" '$1 == key { print $3; exit }' "$MAP_FILE"; }
store_thread() {
  local name="$1" thread="$2" key="$(hash_name "$1")" tmp
  local existing="$(lookup_thread "$name")"
  [[ -z "$existing" || "$existing" == "$thread" ]] || { print -u2 -- "persistent task name already maps to a different thread: $name"; return 1; }
  while ! mkdir "$INDEX_MUTEX" 2>/dev/null; do
    if [[ -f "$INDEX_MUTEX/pid" ]] && ! kill -0 "$(<"$INDEX_MUTEX/pid")" 2>/dev/null; then rm -rf "$INDEX_MUTEX"; else sleep 1; fi
  done
  print -r -- "$$" > "$INDEX_MUTEX/pid"
  trap 'rm -rf "$INDEX_MUTEX"' EXIT
  existing="$(lookup_thread "$name")"
  [[ -z "$existing" || "$existing" == "$thread" ]] || { print -u2 -- "persistent task name already maps to a different thread: $name"; return 1; }
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
