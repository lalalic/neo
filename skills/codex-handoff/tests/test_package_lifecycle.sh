#!/bin/zsh
set -e

ROOT="$(mktemp -d -t codex-handoff-package)"
trap 'rm -rf "$ROOT"' EXIT

for terminal in done failed; do
  inbox="$ROOT/inbox"
  processing="$ROOT/processing"
  destination="$ROOT/$terminal"
  mkdir -p "$inbox" "$processing" "$destination"
  task="$inbox/task-$terminal"
  mkdir "$task"
  print 'request' > "$task/HANDOFF.md"
  print 'NEW' > "$task/STATE"
  print 'returned artifact' > "$task/RETURNED.txt"

  mv "$task" "$processing/"
  task="$processing/task-$terminal"
  print 'RUNNING' > "$task/STATE"
  print "State: ${(U)terminal}" > "$task/STATUS.md"
  print "${(U)terminal}" > "$task/STATE"
  mv "$task" "$destination/"

  [[ -f "$destination/task-$terminal/RETURNED.txt" ]]
  [[ "$(<"$destination/task-$terminal/STATE")" == "${(U)terminal}" ]]
done

task="$inbox/task-review"
mkdir "$task"
print 'request' > "$task/HANDOFF.md"
print 'NEW' > "$task/STATE"
mv "$task" "$processing/"
task="$processing/task-review"
print 'RUNNING' > "$task/STATE"
print 'State: REVIEW' > "$task/STATUS.md"
print 'REVIEW' > "$task/STATE"
mv "$task" "$destination/"
print 'REVISION_REQUESTED' > "$destination/task-review/STATE"
mv "$destination/task-review" "$inbox/"
[[ "$inbox/task-review/STATE" == "REVISION_REQUESTED" ]]

print 'bidirectional package lifecycle tests passed'
