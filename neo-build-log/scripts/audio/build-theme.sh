#!/bin/zsh
set -euo pipefail

output="${1:-runs/neo-build-log/$(date +%Y-%m-%d)-local/assets/bgm/neo-build-log-theme-v1.mp3}"
work="$(mktemp -d "${TMPDIR:-/tmp}/neo-build-log-bgm.XXXXXX")"
trap 'rm -rf "$work"' EXIT

uv run --with numpy python audio/generate-theme.py --out "$work/theme.wav"
mkdir -p "$(dirname "$output")"
ffmpeg -hide_banner -loglevel error -y \
  -i "$work/theme.wav" \
  -af 'loudnorm=I=-16:TP=-2:LRA=7' \
  -codec:a libmp3lame -b:a 192k \
  "$output"

echo "$output"
