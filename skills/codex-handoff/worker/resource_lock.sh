#!/bin/zsh
set -u

STATE_DIR="${CODEX_HANDOFF_STATE_DIR:-/Users/chengli/.codex/handoff-state}"
LOCK_ROOT="$STATE_DIR/resource-locks"
MUTEX="$LOCK_ROOT/.mutex"

hash_key() { print -rn -- "$1" | shasum -a 256 | awk '{print $1}'; }
normalize() { print -r -- "$1" | sed -E 's#^/Users/chengli/Workspace/##; s#^/+##; s#/$##'; }
ensure_root() { mkdir -p "$LOCK_ROOT"; }

reap_stale() {
  local d pid
  for d in "$LOCK_ROOT"/*.lock(N); do
    [[ -f "$d/pid" ]] || { rm -rf "$d"; continue; }
    pid="$(<"$d/pid")"
    kill -0 "$pid" 2>/dev/null || rm -rf "$d"
  done
}

acquire() {
  local scope="${1:?lock scope required}" workspace="$(normalize "${2:-}")" repo="$(normalize "${3:-}")"
  local owner="${4:-$$}" key dir other os ow or
  [[ "$scope" == workspace || "$scope" == repo ]] || return 2
  [[ -n "$workspace" ]] || workspace="unknown"
  [[ -n "$repo" ]] || repo="${workspace%%/*}"
  ensure_root
  while true; do
    mkdir "$MUTEX" 2>/dev/null || { sleep 1; continue; }
    reap_stale
    local conflict=0
    for other in "$LOCK_ROOT"/*.lock(N); do
      [[ -f "$other/scope" ]] || continue
      os="$(<"$other/scope")"; ow="$(<"$other/workspace")"; or="$(<"$other/repo")"
      if [[ "$scope" == repo && "$os" == repo && "$repo" == "$or" ]] ||
         [[ "$scope" == repo && "$os" == workspace && "$repo" == "$or" ]] ||
         [[ "$scope" == workspace && "$os" == repo && "$repo" == "$or" ]] ||
         [[ "$scope" == workspace && "$os" == workspace && "$workspace" == "$ow" ]]; then
        conflict=1; break
      fi
    done
    if (( conflict == 0 )); then
      key="$scope:$workspace:$repo"
      dir="$LOCK_ROOT/$(hash_key "$key").lock"
      mkdir "$dir" 2>/dev/null || { rmdir "$MUTEX"; sleep 1; continue; }
      print -r -- "$scope" > "$dir/scope"
      print -r -- "$workspace" > "$dir/workspace"
      print -r -- "$repo" > "$dir/repo"
      print -r -- "$owner" > "$dir/pid"
      rmdir "$MUTEX"
      print -r -- "$dir"
      return 0
    fi
    rmdir "$MUTEX"
    sleep 2
  done
}

release() {
  local dir="${1:?lock directory required}"
  ensure_root
  while ! mkdir "$MUTEX" 2>/dev/null; do sleep 1; done
  rm -rf "$dir"
  rmdir "$MUTEX"
}

case "${1:-}" in
  acquire) shift; acquire "$@" ;;
  release) shift; release "$@" ;;
  *) print -u2 -- "usage: $0 acquire SCOPE WORKSPACE REPO [OWNER] | release LOCK_DIR"; exit 2 ;;
esac
