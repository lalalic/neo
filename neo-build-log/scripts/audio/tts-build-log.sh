#!/bin/zsh
set -euo pipefail

if (( $# != 2 )); then
  echo "usage: $0 <text> <output-audio>" >&2
  exit 2
fi

text="$1"
output="$2"
work="$(mktemp -d "${TMPDIR:-/tmp}/neo-build-log-tts.XXXXXX")"
trap 'rm -rf "$work"' EXIT

instruct='中文科技创作者的 build log。自然、克制、聪明，像在给朋友解释刚刚解决的问题。中低音，语速略快但清晰，不要广告腔，不要播音腔，不要夸张。问题陈述干净，真正的发现轻微提气，证据部分克制，结尾自然落下。英文技术名词自然读出。'

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
default_ref="$project_dir/../vlog/runtime/voices/ray-talk.wav"
default_ref_text_file="$project_dir/../vlog/runtime/voices/stt-talk.txt"
if [[ -z "${NEO_BUILD_LOG_VOICE_REF:-}" && -f "$default_ref" && -s "$default_ref_text_file" ]]; then
  export NEO_BUILD_LOG_VOICE_REF="$default_ref"
  export NEO_BUILD_LOG_VOICE_REF_TEXT="$(cat "$default_ref_text_file")"
fi

if [[ -n "${NEO_BUILD_LOG_VOICE_REF:-}" && -f "${NEO_BUILD_LOG_VOICE_REF}" && -n "${NEO_BUILD_LOG_VOICE_REF_TEXT:-}" ]]; then
  # Preferred path: clone the user's accepted, clean presenter reference.
  uvx --from mlx-audio mlx_audio.tts.generate \
    --model mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit \
    --text "$text" \
    --ref_audio "$NEO_BUILD_LOG_VOICE_REF" \
    --ref_text "$NEO_BUILD_LOG_VOICE_REF_TEXT" \
    --lang_code zh \
    --speed 1.06 \
    --output_path "$work" \
    --file_prefix narration \
    --audio_format wav >/dev/null
else
  # Reproducible fallback before a verified personal voice reference exists.
  uvx --from mlx-audio mlx_audio.tts.generate \
    --model mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit \
    --text "$text" \
    --voice Uncle_Fu \
    --instruct "$instruct" \
    --lang_code zh \
    --speed 1.06 \
    --output_path "$work" \
    --file_prefix narration \
    --audio_format wav >/dev/null
fi

source_file="$(find "$work" -type f -name 'narration*.wav' | head -1)"
if [[ -z "$source_file" ]]; then
  echo "TTS produced no audio" >&2
  exit 1
fi

mkdir -p "$(dirname "$output")"
case "${output:e:l}" in
  wav)
    cp "$source_file" "$output"
    ;;
  mp3)
    ffmpeg -hide_banner -loglevel error -y -i "$source_file" \
      -codec:a libmp3lame -b:a 192k "$output"
    ;;
  *)
    ffmpeg -hide_banner -loglevel error -y -i "$source_file" "$output"
    ;;
esac
