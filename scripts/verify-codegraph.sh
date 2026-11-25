#!/bin/sh
set -eu
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/main"
branch="$tmp/work"
mkdir "$repo"
git -C "$repo" init -q
cat > "$repo/example.js" <<'JS'
export function mainOnly() { return 1; }
export function invokeMain() { return mainOnly(); }
JS
git -C "$repo" add example.js
git -C "$repo" -c user.name=Test -c user.email=test@example.invalid commit -qm base
git -C "$repo" worktree add -q --detach "$branch" HEAD
cat > "$branch/example.js" <<'JS'
export function branchOnly() { return 2; }
export function invokeBranch() { return branchOnly(); }
JS
for path in "$repo" "$branch"; do
    codegraph init --yes --local-only "$path" >/dev/null
    test -f "$path/.codegraph/codegraph.db"
    git -C "$path" check-ignore -q .codegraph/codegraph.db
done
assert_symbol() {
    codegraph query --path "$1" --json --limit 8 "$2" | python3 -c 'import json,sys; names=[v["node"]["name"] for v in json.load(sys.stdin)]; assert (sys.argv[1] in names)==(sys.argv[2]=="present"),names' "$2" "$3"
}
assert_symbol "$repo" mainOnly present
assert_symbol "$branch" branchOnly present
assert_symbol "$branch" mainOnly absent
assert_symbol "$repo" branchOnly absent
codegraph callers --path "$branch" --limit 8 branchOnly | grep -q invokeBranch
printf '\nexport function addedAfterIndex() { return branchOnly(); }\n' >> "$branch/example.js"
codegraph sync --quiet "$branch"
assert_symbol "$branch" addedAfterIndex present
assert_symbol "$repo" addedAfterIndex absent
codegraph callers --path "$branch" --limit 8 branchOnly | grep -q addedAfterIndex
test -z "$(git -C "$repo" status --porcelain --untracked-files=all)"
test "$(git -C "$branch" status --porcelain --untracked-files=all)" = " M example.js"
printf 'PASS: isolated indexes, caller relationships, incremental sync, Git ignore\n'
