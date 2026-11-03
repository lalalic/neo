#!/usr/bin/env bash
set -euo pipefail

source_url="https://github.com/msitarzewski/agency-agents.git"
target="${AGENCY_AGENTS_HOME:-$HOME/.local/share/agency-agents}"
expected="$target/integrations/dsh"

if [[ ! -d "$target/.git" ]]; then
  if [[ -e "$target" ]]; then
    echo "Not a managed Agency Agents checkout: $target" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$target")"
  git clone --depth 1 "$source_url" "$target"
fi

if [[ ! -s "$expected/agency-frontend-developer/SKILL.md" ]]; then
  (cd "$target" && ./scripts/convert.sh --tool dsh)
fi

count="$(find "$expected" -name SKILL.md -type f | wc -l | tr -d ' ')"
if [[ "$count" -lt 1 ]]; then
  echo "No usable Agency Agents role SKILL.md files found" >&2
  exit 1
fi

echo "Agency Agents pool ready: $count roles ($expected)"
