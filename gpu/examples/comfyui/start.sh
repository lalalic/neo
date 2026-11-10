#!/usr/bin/env bash
set -euo pipefail

# Session-local data. Download outputs before the provider's hard stop.
DATA_DIR="${COMFY_DATA_DIR:-/neo/comfyui}"
mkdir -p "$DATA_DIR"/{models,input,output,temp,user}
PYTHON="${COMFYUI_PYTHON:-/opt/neo-comfy-venv/bin/python}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "ComfyUI Python environment missing: $PYTHON" >&2
  exit 1
fi
ARGS=(--listen 0.0.0.0 --port "${NEO_GPU_APP_PORT:-8188}" \
  --disable-auto-launch --base-directory "$DATA_DIR")
if [[ "${COMFYUI_FORCE_CPU:-0}" == '1' ]]; then ARGS+=(--cpu); fi
exec "$PYTHON" /opt/ComfyUI/main.py "${ARGS[@]}"
