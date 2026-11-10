# Preinstalled CUDA/PyTorch/ComfyUI image: no model weights are embedded.
# Neo wraps the project's CMD with its authenticated Web proxy on port 8000.
FROM ghcr.io/ai-dock/comfyui:latest-cuda
USER root
ENV PYTHONUNBUFFERED=1
COPY gpu/examples/comfyui/start.sh /opt/neo/comfyui-start.sh
# Do not launch AI-Dock's supervisor/Jupyter/SSH/auth services: Neo owns the gate.
ENTRYPOINT []
CMD ["/bin/bash", "/opt/neo/comfyui-start.sh"]
