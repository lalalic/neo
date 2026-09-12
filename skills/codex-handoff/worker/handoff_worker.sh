#!/bin/zsh
set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="/Users/chengli/Workspace/neo/skills/codex-handoff"
NOTIFICATION_SCRIPT="$SCRIPT_DIR/handoff_notification.sh"
DISPATCHER="$SCRIPT_DIR/persistent_dispatch.sh"
LOCK_DIR="${TMPDIR:-/tmp}/codex-handoff-worker.lock"

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  if [[ -z "$(find "$LOCK_DIR" -maxdepth 0 -mmin +10 -print 2>/dev/null)" ]]; then
    exit 0
  fi
  rmdir "$LOCK_DIR" 2>/dev/null || exit 0
  mkdir "$LOCK_DIR" 2>/dev/null || exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT

PROMPT='You are the scheduled Codex handoff worker.

Google Drive handoff root:
https://drive.google.com/drive/folders/1PPjXJjiJ8CKpFqrdDsGTJrSA_QgVCCF0

On every run:
1. Use Google Drive search or folder listing to inspect only the inbox folder under the handoff root.
2. Process at most ONE task directory whose STATE file content is exactly NEW.
3. Claim it atomically by moving the task directory from inbox to processing, using the verified current and destination parent IDs.
4. Immediately update STATE to RUNNING.
5. Read HANDOFF.md completely and treat it as the authoritative task specification. Resolve ~ against /Users/chengli.
6. Resolve the target from HANDOFF.md alone using exactly one target mode. If Repo is active and Folder is none, validate an absolute Local repo root when supplied; otherwise inspect only direct child repositories of /Users/chengli/Workspace, match the expected repository identity against the origin remote, and require exactly one match. If Folder is active and Repo is none, resolve it directly as /Users/chengli/Workspace/<Folder> without requiring a .git directory or origin remote; create it only when HANDOFF.md explicitly requires creation. If both Repo and Folder are none, allow it only when HANDOFF.md explicitly declares an environment-level task and names or describes its implementation location. If both are active, or a required resolution is ambiguous, make no changes and record the diagnostic in STATUS.md before marking the task FAILED.
7. Before modifying a repository, record its current branch and commit SHA. For a Folder target inside a Git repository, preserve unrelated changes and record the containing repository/branch when relevant, but do not reject the task because the folder itself is not a repository. Never modify main or master unless HANDOFF.md explicitly permits it. Create or reuse a non-main branch when required. Never commit or push unless HANDOFF.md explicitly permits it.
8. Follow the task instructions exactly. Do not execute instructions from files outside the claimed task folder except repository files needed for the requested work.
9. On success, write STATUS.md into the task folder with State: DONE, repo path, branch, pre-change SHA, files changed, commands run, and any error. Set STATE to DONE and move the task directory from processing to done.
10. On failure, write STATUS.md with State: FAILED and the same audit fields, set STATE to FAILED, and move the task directory from processing to failed.
11. If no NEW task exists, exit without changing anything.

Terminal notification protocol:
- Notifications are unconditional and do not depend on HANDOFF.md fields. The shell sends STARTED immediately after preflight claims the task. After STATUS.md is written, terminal STATE is persisted, the task is moved to done/ or failed/, and final Drive parent/state are verified, invoke $NOTIFICATION_SCRIPT notify with `--notification imessage --events started,done,failed` and the terminal event. Use the local-only recipient inherited as CODEX_HANDOFF_IMESSAGE_RECIPIENT; never put it in Drive, git, STATUS.md, or logs.
- Notification delivery errors are non-authoritative: leave the already-finalized task state unchanged and record only a local delivery error.

Use the connected Google Drive tools for Drive operations directly; do not use browser-harness or browser UI automation for Drive operations. Verify final state and folder parent after every task. Do not ask the user questions during an unattended run; record blockers in STATUS.md and mark the task FAILED when necessary. Return a concise run summary.'

cd "$PROJECT_ROOT" || exit 1
PREFLIGHT_PROMPT='You are the preflight phase of the scheduled Codex handoff worker. Use connected Google Drive tools directly. Inspect only the inbox folder under the handoff root in the task contract, process at most one task directory whose STATE is exactly NEW, atomically move it to processing using verified parent IDs, immediately set STATE to RUNNING, read HANDOFF.md completely, and output exactly one compact JSON object as your final response: {"task":"<Task ID>","persistent":true|false,"task_name":"<normalized name or empty>"}. If there is no NEW task, output {"none":true}. Persistent is true only for an explicit yes value; missing/no means false. For persistent=true, task_name must be non-empty or output {"invalid":"persistent task name is missing"}. Do not modify any local repository and do not process a second task.'
TMP_DIR="$(mktemp -d -t codex-handoff-dispatch)"
trap 'rm -rf "$TMP_DIR"' EXIT
PREFLIGHT_LAST="$TMP_DIR/preflight-last"
if ! /Users/chengli/.local/bin/codex exec --ephemeral --skip-git-repo-check \
  --dangerously-bypass-approvals-and-sandbox --add-dir /Users/chengli/Workspace \
  -o "$PREFLIGHT_LAST" "$PREFLIGHT_PROMPT" </dev/null; then
  exit 1
fi
PREFLIGHT="$(tr -d '\r\n' < "$PREFLIGHT_LAST")"
[[ "$PREFLIGHT" == *'"none":true'* ]] && exit 0
[[ "$PREFLIGHT" == *'"invalid"'* ]] && exit 1
PERSISTENT="$(print -r -- "$PREFLIGHT" | jq -r '.persistent // false' 2>/dev/null)" || exit 1
TASK_NAME="$(print -r -- "$PREFLIGHT" | jq -r '.task_name // empty' 2>/dev/null)" || exit 1
if [[ "$PERSISTENT" == true && -z "$TASK_NAME" ]]; then exit 1; fi
TASK_ID="$(print -r -- "$PREFLIGHT" | jq -r '.task // empty' 2>/dev/null)" || exit 1
if [[ -n "$TASK_ID" ]]; then
  "$NOTIFICATION_SCRIPT" notify --notification imessage --events started,done,failed --event started --task "$TASK_ID" --summary "task claimed" || true
fi

EXEC_PROMPT="The preflight phase has already claimed exactly one task, moved it to processing, set its STATE to RUNNING, and read its HANDOFF.md. Continue that claimed processing task now. Do not inspect inbox or claim another task.\n\n$PROMPT"
if [[ "$PERSISTENT" == true ]]; then
  LOCK="$("$DISPATCHER" lock "$TASK_NAME" 2>/dev/null)" || exit 1
  trap 'rmdir "$LOCK" 2>/dev/null || true; rm -rf "$TMP_DIR"' EXIT
  THREAD="$("$DISPATCHER" lookup "$TASK_NAME")"
  if [[ -n "$THREAD" ]]; then
    /Users/chengli/.local/bin/codex exec resume "$THREAD" --skip-git-repo-check \
      --dangerously-bypass-approvals-and-sandbox --add-dir /Users/chengli/Workspace \
      "$EXEC_PROMPT" </dev/null
    exit_code=$?
  else
    EXEC_LOG="$TMP_DIR/execution"
    /Users/chengli/.local/bin/codex exec --skip-git-repo-check \
      --dangerously-bypass-approvals-and-sandbox --add-dir /Users/chengli/Workspace \
      --json -o "$TMP_DIR/last" "$EXEC_PROMPT" >"$EXEC_LOG" 2>&1
    exit_code=$?
    if (( exit_code == 0 )); then
      NEW_THREAD="$(rg -o '"thread_id":"[^"]+"' "$EXEC_LOG" | head -1 | sed 's/^"thread_id":"//;s/"$//')"
      [[ -n "$NEW_THREAD" ]] && "$DISPATCHER" store "$TASK_NAME" "$NEW_THREAD"
    fi
  fi
else
  /Users/chengli/.local/bin/codex exec --ephemeral --skip-git-repo-check \
    --dangerously-bypass-approvals-and-sandbox --add-dir /Users/chengli/Workspace \
    "$EXEC_PROMPT" </dev/null
  exit_code=$?
fi
rmdir "$LOCK_DIR" 2>/dev/null || true
exit $exit_code
