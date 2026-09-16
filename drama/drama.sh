#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export UV_CACHE_DIR="${UV_CACHE_DIR:-$PWD/.cache/uv}"
export UV_TOOL_DIR="${UV_TOOL_DIR:-$PWD/.cache/uv-tools}"
export UV_TOOL_BIN_DIR="${UV_TOOL_BIN_DIR:-$PWD/.cache/uv-bin}"
export HF_HOME="${HF_HOME:-$PWD/.cache/huggingface}"
exec python3 drama.py "$@"
