# ComfyUI — Neo Compute interactive GPU Web app

This **Web-only** service builds a pinned ComfyUI release on the official PyTorch CUDA base.
Dependencies are installed during image build, never on each paid GPU startup. Neo wraps it with the shared Node.js
HTTP/WebSocket proxy and keeps access and lifecycle control at its gateway.
No SSH, Jupyter, or additional app-facing service is launched; Neo
supplies the only public authentication gate.

## Build (once) on Neo Master

Run from the **Neo source Git root**, after commit + push:

```sh
neo compute build --dockerfile gpu/examples/comfyui/Dockerfile \
  --mode web --port 8188 --name comfyui --dry-run
neo compute build --dockerfile gpu/examples/comfyui/Dockerfile \
  --mode web --port 8188 --name comfyui
neo compute web add comfyui --provider hf --budget 2
neo compute web status
```

Open `https://compute.qili2.com/comfyui/` and unlock with the private token
(`neo compute web token comfyui` on the trusted Neo Master). Use the Start GPU
button only after authorizing paid compute; close with Stop GPU. Visiting the
URL alone is free, and a started session has a **hard one-hour limit**.

### Models and generated files

Built image contains ComfyUI v0.45.0 plus Python/CUDA, **not** AI model weights
or checkpoint bundles. Workflow templates may be provided by upstream ComfyUI. Install or download model weights during the
session or publish a separately tagged image with vetted preloaded models.
Never bake private HF tokens or images into a public image. The scratch directory
`/neo/comfyui` (models/input/output/user) is ephemeral on HF/Vast leases; outputs
must be downloaded before stopping, and large model downloads cost setup time.

### UI compatibility

ComfyUI's current frontend may use root-absolute asset/API paths, which can
break beneath the Neo Gateway `/comfyui/` prefix. A successful gateway health
check **does not** prove that the UI works. Before calling the service ready,
start an authorized GPU session and use an actual browser to confirm the editor,
node loading, WebSocket, model selection, and media preview. A dedicated-host
route or a prefix-aware upstream frontend build is required if those tests fail.
Do not publish an untested claim that UI subpaths are fully supported.

### No-spend checks

```sh
bash -n gpu/examples/comfyui/start.sh
neo compute build --dockerfile gpu/examples/comfyui/Dockerfile \
  --mode web --port 8188 --name comfyui --dry-run
```
