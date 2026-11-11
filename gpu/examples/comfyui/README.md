# ComfyUI — Neo Compute prebuilt GPU Web service

This **Web-only** service inherits the upstream
[YanWenKun ComfyUI-Docker CUDA 13.0 Slim image](https://github.com/YanWenKun/ComfyUI-Docker/tree/main/cu130-slim).
The image is pinned by date tag **and registry digest**. It includes ComfyUI,
ComfyUI-Manager, PyTorch, CUDA dependencies, and the upstream startup script.
There is **no Neo-specific Python installation or duplicate startup script**.
Neo wraps the inherited `bash /runner-scripts/entrypoint.sh` command with its
shared Node HTTP/WebSocket proxy, serving ComfyUI on internal port `8188`.

## Build and register

Run from the Neo Git root, after commit + push:

```sh
neo compute build --dockerfile gpu/examples/comfyui/Dockerfile \
  --mode web --port 8188 --name comfyui --dry-run
neo compute build --dockerfile gpu/examples/comfyui/Dockerfile \
  --mode web --port 8188 --name comfyui
neo compute web update comfyui  # existing service: preserve token/provider/budget
# For a fresh installation, use: neo compute web add comfyui --provider hf --budget 2
neo compute web status comfyui
```

Public address: `https://compute.qili2.com/comfyui/`.
Retrieve the existing private access token with `neo compute web token comfyui`
on Neo Master; no token is committed or printed during a service image update.
Only the authenticated **Start GPU** action rents a GPU. A started Web session
has a hard limit of 3600 seconds (one hour), with a separate Stop action.
The advisory budget is *not* a provider-enforced hard cap.

## Model storage and outputs

The upstream entrypoint copies its bundled ComfyUI tree to `/root/ComfyUI`
on the first start. Its default locations are `/root/ComfyUI/models`,
`/root/ComfyUI/input`, `/root/ComfyUI/output`, and `/root/ComfyUI/user`.
These live on the **ephemeral provider filesystem** in the current Neo Compute
integration: downloads, installed custom nodes, workflow files, and model weights
will not persist between GPU rentals. Download outputs before stopping.
The image does **not** preload large Wan/LTX checkpoints; users can fetch them
using ComfyUI-Manager or create a separate model-cached image later.

CUDA 13.0 requires a compatible GPU driver; the default HF L4 GPU uses Ada.
If a chosen Vast offer has an older NVIDIA driver, use a compatible CUDA 12.6
image instead. Do not silently change GPU/provider during an active lease.

## UI verification and risks

A successful image build or Gateway health check does not establish that the
editor works under Neo's `/comfyui/` URL prefix. Check node editor, assets,
`/object_info`, WebSocket `/ws`, media preview, and actual model generation
with a real GPU session before claiming GPU E2E success. The upstream frontend
may use root-absolute URLs. If that occurs, the service needs a dedicated
hostname or a prefix-aware frontend/proxy. Do not weaken Neo's token gate.

## No-spend regression

```sh
node --test test/neo-gpu-comfyui.test.mjs test/neo-gpu-web.test.mjs
neo compute build --dockerfile gpu/examples/comfyui/Dockerfile \
  --mode web --port 8188 --name comfyui --dry-run
```
