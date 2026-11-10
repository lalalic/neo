# Current official PyTorch CUDA runtime and a verified, pinned ComfyUI release.
# No AI weights, credentials, SSH, or auxiliary service is included.
FROM pytorch/pytorch:2.12.1-cuda12.6-cudnn9-runtime
USER root
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    git ffmpeg python3-venv libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
ARG COMFYUI_TAG=v0.45.0
ARG COMFYUI_COMMIT=989d93d0d968e704c589ce0146bb18c77f6b50cc
RUN git clone --quiet --depth 1 --branch "$COMFYUI_TAG" \
    https://github.com/Comfy-Org/ComfyUI.git /opt/ComfyUI \
    && test "$(git -C /opt/ComfyUI rev-parse HEAD)" = "$COMFYUI_COMMIT" \
    && python -m venv --system-site-packages /opt/neo-comfy-venv \
    && /opt/neo-comfy-venv/bin/python -m pip install --no-cache-dir \
       -r /opt/ComfyUI/requirements.txt \
    && /opt/neo-comfy-venv/bin/python -c "import torch; import aiohttp"
COPY gpu/examples/comfyui/start.sh /opt/neo/comfyui-start.sh
WORKDIR /opt/ComfyUI
ENTRYPOINT []
CMD ["/bin/bash", "/opt/neo/comfyui-start.sh"]
