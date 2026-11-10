#!/usr/bin/env bash
set -euo pipefail

# Session-local scratch. Export generated files before the 1-hour hard stop.
DATA_DIR="${COMFY_DATA_DIR:-/neo/comfyui}"
mkdir -p "$DATA_DIR"/{models,input,output,temp,user}
PYTHON="${COMFYUI_VENV_PYTHON:-/opt/ai-dock/venvs/comfyui/bin/python}"
if [[ ! -x "$PYTHON" ]]; then
  echo "ComfyUI Python environment missing: $PYTHON" >&2
  exit 1
fi
exec "$PYTHON" /opt/ComfyUI/main.py \
  --listen 0.0.0.0 --port "${NEO_GPU_APP_PORT:-8188}" \
  --disable-auto-launch --base-directory "$DATA_DIR"
