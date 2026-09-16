#!/bin/zsh
set -euo pipefail
usage(){ echo "usage: $0 [--series <series-name>] <slug> [title]" >&2; exit 2; }
series=""
if [[ "${1:-}" == "--series" ]]; then [[ $# -ge 3 ]] || usage; series="$2"; shift 2; fi
[[ $# -ge 1 ]] || usage
slug="$1"; title="${2:-${slug//-/ }}"
[[ "$slug" =~ '^[a-z0-9][a-z0-9-]*$' ]] || { echo "slug must use lowercase letters, digits, and hyphens" >&2; exit 2; }
[[ -z "$series" || "$series" =~ '^[a-z0-9][a-z0-9-]*$' ]] || { echo "series must use lowercase letters, digits, and hyphens" >&2; exit 2; }
script_dir="${0:A:h}"; project_dir="${script_dir:h}"
day="${HIGHLIGHT_DATE:-$(date +%Y-%m-%d)}"; occurred_at="${HIGHLIGHT_OCCURRED_AT:-$day}"
event_id="${day}-${slug}"
[[ -n "$series" ]] && event_dir="$project_dir/runs/$series/$event_id" || event_dir="$project_dir/runs/$event_id"
[[ ! -e "$event_dir" ]] || { echo "highlight already exists: $event_dir" >&2; exit 1; }
mkdir -p "$event_dir/assets"
sed -e "s/{{EVENT_ID}}/$event_id/g" -e "s/{{OCCURRED_AT}}/$occurred_at/g" -e "s/{{TITLE}}/$title/g" "$project_dir/templates/source.md" > "$event_dir/source.md"
sed -e "s/{{EVENT_ID}}/$event_id/g" "$project_dir/templates/review.md" > "$event_dir/REVIEW.md"
cat <<EOF2
Created $event_id
  source: $event_dir/source.md
  review: $event_dir/REVIEW.md
  media:  $event_dir/assets/
Next: fill source.md, then use #markcut to direct $event_dir/video.md.
EOF2
