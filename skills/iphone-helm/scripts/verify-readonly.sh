#!/bin/sh
# Only black-box inspect and QA read effects; never send messages or post.
set -eu
CLI="${IPHONE_HELM_CLI:-$HOME/.local/bin/iphone-helm}"
test -x "$CLI" || { echo 'CLI missing; run setup.sh' >&2; exit 1; }
test -n "${IPHONE_HELM_MCP_URL:-}" || { echo 'Set IPHONE_HELM_MCP_URL for a real physical iPhone' >&2; exit 1; }
test -n "${IPHONE_HELM_TOKEN_FILE:-}" || { echo 'Set IPHONE_HELM_TOKEN_FILE' >&2; exit 1; }
"$CLI" health
"$CLI" app run wechat inspect --input '{}'
"$CLI" app run toyalive qa-check --input '{}'
printf 'READ_ONLY_REAL_IPHONE_SMOKE_PASS\n'
