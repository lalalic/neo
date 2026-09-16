#!/bin/zsh
set -euo pipefail
if [[ $# -ne 2 ]]; then
  echo "usage: $0 <text> <output>" >&2
  exit 2
fi
TEXT="$1"
OUTPUT="$2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN_DIR="${VLOG_RUN_DIR:-$ROOT/runs/current}"
VOICE_DIR="$RUN_DIR/private/voices"
REF_MP3="$VOICE_DIR/ray-talk.mp3"
REF_WAV="$VOICE_DIR/ray-talk.wav"
REF_TEXT="${VLOG_VOICE_REF_TEXT:-}"
mkdir -p "$VOICE_DIR" "$(dirname "$OUTPUT")"
if [[ ! -s "$REF_WAV" || -z "$REF_TEXT" ]]; then
  echo "missing private voice reference: provide $REF_WAV and VLOG_VOICE_REF_TEXT" >&2
  exit 1
fi
mkdir -p "$RUN_DIR/tmp"
TMP="$(mktemp -d "$RUN_DIR/tmp/tts-ray.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
uvx --from mlx-audio mlx_audio.tts.generate \
  --model mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit \
  --text "$TEXT" \
  --ref_audio "$REF_WAV" \
  --ref_text "$REF_TEXT" \
  --output_path "$TMP" --file_prefix narration --join_audio >/dev/null
ffmpeg -y -hide_banner -loglevel error -i "$TMP/narration.wav" -codec:a libmp3lame -q:a 2 "$OUTPUT"
