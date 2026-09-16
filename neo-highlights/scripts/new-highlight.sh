#!/bin/zsh
set -euo pipefail

usage() {
  echo "usage: $0 <slug> [title]" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage

slug="$1"
title="${2:-${slug//-/ }}"

if [[ ! "$slug" =~ '^[a-z0-9][a-z0-9-]*$' ]]; then
  echo "slug must use lowercase letters, digits, and hyphens" >&2
  exit 2
fi

script_dir="${0:A:h}"
project_dir="${script_dir:h}"
day="${HIGHLIGHT_DATE:-$(date +%Y%m%d)}"
occurred_at="${HIGHLIGHT_OCCURRED_AT:-$(date +%Y-%m-%d)}"
event_id="${day}-${slug}"
event_dir="$project_dir/runs/$event_id"

if [[ -e "$event_dir" ]]; then
  echo "highlight already exists: $event_dir" >&2
  exit 1
fi

mkdir -p "$event_dir/assets"

sed \
  -e "s/{{EVENT_ID}}/$event_id/g" \
  -e "s/{{OCCURRED_AT}}/$occurred_at/g" \
  -e "s/{{TITLE}}/$title/g" \
  "$project_dir/templates/source.md" > "$event_dir/source.md"

sed \
  -e "s/{{EVENT_ID}}/$event_id/g" \
  "$project_dir/templates/review.md" > "$event_dir/REVIEW.md"

cat <<EOF
Created $event_id
  source: $event_dir/source.md
  review: $event_dir/REVIEW.md
  media:  $event_dir/assets/

Next: fill source.md, then use #markcut to direct $event_dir/video.md.
EOF
