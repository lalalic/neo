#!/bin/zsh
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
npx pm2 startOrReload ecosystem.config.cjs --update-env
npx pm2 save
print -r -- 'codex-handoff-worker started/reloaded under PM2'
