# Hello Neo — default tiny real-GPU smoke service

A single **tiny** Dockerfile, no model weights, PyTorch or CUDA Toolkit. A
throw-away Debian compiler stage builds a small C binary and discards the
compiler. The final Node.js slim image is compatible with Neo Compute's standard
wrapper and works in **both batch and web mode**.

`cuda-probe.c` dynamically loads **libcuda.so.1** from the provider's GPU driver,
creates a CUDA context, loads a short PTX kernel, launches it on the GPU, copies
its answer back to CPU and verifies `40 + 2 = 42`. A container that merely
starts without CUDA does **not** pass. No CPU fallback is permitted.

## Build / run on Neo Master

From the Neo source Git root, after pushing the fixture to GitHub:

```sh
# Local no-spend proof of image build plans.
node gpu/examples/hello-neo/e2e.mjs

# Publish and test real HF GPU Job + HTTPS Web mode (two versioned images).
node gpu/examples/hello-neo/e2e.mjs --live --allow-spend --build

# On subsequent runs, reuse the exact same published images without rebuilding.
node gpu/examples/hello-neo/e2e.mjs --live --allow-spend

# Test a verified Vast.ai GPU instead (requires a suitable available offer).
node gpu/examples/hello-neo/e2e.mjs --live --allow-spend --vast
```

The smoke image registers as `hello-neo-job` (batch) and `hello-neo-web` (HF Web),
with the second URL at `https://compute.qili2.com/hello-neo-web/`. Vast Web reuses
the **same exact Web image** under `hello-neo-vast-web`
(`https://compute.qili2.com/hello-neo-vast-web/`), without republishing it. Web
services remain **token gated and stopped** after each test; use `neo compute web
token SERVICE` locally to access either optional demonstration. Opening the URL
never rents a GPU. The web test uses a 300-second hard limit; the batch test
uses 420 seconds. Provider cost estimates are advisory, not hard billing caps.

Input `request.json` may contain `{ "message": "hello neo", "requestId": "..." }`.
Batch output `result.json` and Web `/api/hello` both include `message`,
`device`, `cuda: true`, `cudaSignature: hello-neo-cuda-v1` and
`kernelResult: 42`. The runner verifies the exact response and that resources
are actually stopped. It saves local, private receipts in
`~/.local/state/neo/gpu/hello-neo/`.

The local unit test deliberately asserts the CUDA probe **fails without a GPU**;
no mocked success is treated as a real CUDA PASS.
