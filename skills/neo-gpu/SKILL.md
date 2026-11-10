---
name: neo-gpu
description: Build reusable GPU service images from project Dockerfiles, then run bounded jobs on Hugging Face Jobs or Vast.ai through the built-in Neo GPU CLI. Use for GPU service packaging, cost/provider selection, dry runs, troubleshooting, and cleanup.
---

# Neo GPU

Use `neo gpu` when a project needs rented GPU compute or a reusable GPU service image. This is a **built-in Node.js Neo CLI module**, not a separate package or a Relay Job runner. The project owns its Dockerfile and computation; Neo owns a shared service wrapper, image registry, transport and provider adapters.

## Choose the action

- **Build or reuse an image:** `neo gpu build` produces a versioned GHCR image from the project Dockerfile; `neo gpu services` lists saved service names and images. Build once and reuse across runs and providers.
- **Interactive web UI:** `neo gpu build --mode web --port 7860`, then `neo gpu web add SERVICE` provisions a token-gated stable URL. `neo gpu web serve` runs the persistent gateway; `neo gpu web status|token|rotate|start|stop` manages it. The 3600-second default is a **hard** session limit (not an idle timeout) and cannot be lengthened via web CLI. Opening the URL does not start a GPU; the authenticated Start button or explicit CLI `--allow-spend` does.
- **Execute GPU work:** `neo gpu run SERVICE --provider hf|vast` uploads explicitly named inputs and fetches explicitly named outputs. Use `--image ghcr.io/OWNER/NAME:TAG` to run a known image directly.
- **Automated E2E:** `node gpu/e2e/container-smoke.mjs` runs the single Dockerfile as real batch and web containers in local Docker Buildx without cloud rental (also CI on GPU commits). `node gpu/e2e/run.mjs` dry-runs the same tiny Dockerfile in batch and web modes; `--live --allow-spend --build` opts into actual short HF Jobs, real input/output and token-guarded public-web verification with automatic cleanup. The fixture uses `cpu-basic`, **not** CUDA inference.
- **Verify real NVIDIA GPU:** Prefer the default [Hello Neo CUDA fixture](../../gpu/examples/hello-neo/README.md): `node gpu/examples/hello-neo/e2e.mjs` is a no-spend dry run; add `--live --allow-spend --build` to publish and verify real HF T4 Batch and HTTPS Web, or reuse images with `--vast` for Vast.ai. It launches a PTX kernel and checks the device result; CPU-only E2E cannot substitute for this.
- **Remove test web registrations:** `neo gpu web remove SERVICE` only works after a verified stopped/failed session; never remove a running paid session.
- **Diagnose or clean up:** `neo gpu doctor` checks required local tools. `neo gpu cleanup --lease PATH` removes a previously leased remote resource; use the actual lease path, not a guessed identifier.

For project-independent Docker construction and provider details, read [GPU service contract](../../gpu/README.md) on demand; do not reproduce its protocol in an agent prompt.

## Normal workflow

1. Verify the project's Git root, Dockerfile and permissions. For **batch** mode its process must read `/neo/input/`, write `/neo/output/`, and exit 0 only when results are ready. For **web** mode its process must serve HTTP on the configured `--port`, with a base path such as `/SERVICE/`. The shared wrapper supplies the HTTP service; do not build a separate project HTTP API.
2. Check `neo gpu doctor`. Review a build with `neo gpu build --dry-run --project PROJECT_ROOT`.
3. Build with `neo gpu build --project PROJECT_ROOT` (hosted GitHub Actions, public pushed matching-owner source) or `--builder local` for private/local-only source with configured Docker/Buildx. Verify with `neo gpu services`.
4. Plan a run with `neo gpu run SERVICE --provider hf --input image.png=LOCAL --output result.mp4=LOCAL --budget 2 --max-seconds 1200 --dry-run`. Choose `vast` only when its GPU, SSH, disk and rental requirements suit the job.
5. **Only after authorization** to spend and upload, repeat without `--dry-run`, adding `--allow-spend` and `--allow-upload` as required. Verify the downloaded output and provider cleanup; an accepted rental/submission is not proof of success.

For Vast Web, confirm the persistent gateway LaunchAgent can execute `vastai` from `~/.local/bin` through its explicit PATH; working interactive-shell credentials alone do not validate its SSH tunnel. For web mode, always keep the random 256-bit access token outside repositories/logs and use the HTTPS Cloudflare tunnel. The persistent gateway needs its own HF private proxy credential (0600 `~/.cache/huggingface/token` or gateway environment); merely having `HF_TOKEN` in an interactive shell is insufficient. Never attempt to rent a paid web Job when the gateway cannot authenticate. Browser cookies are HttpOnly and Start/Stop is origin checked. Provider-side HF `--timeout` and the detached per-session watchdog enforce one-hour shutdown; Vast watchdog depends on a running Neo Master and may be delayed by host sleep/offline. Do not claim a video/UI is publicly live unless DNS, tunnel, gateway, and application are actually tested.

`--budget` is an advisory check, **not** a hard billing cap; provider charges can differ. Provider deadlines and cleanup differ: HF Jobs has a server-side timeout and Vast uses a separate rental-destruction watchdog. Never commit model credentials, private media, output artifacts or lease details into the source Git repository. Do not silently fall back to another provider or rebuild on every invocation.

## Agent decision checks

- *Reuse an already built image on another provider:* use `services` and `run`; do not recreate the Dockerfile or rebuild unnecessarily.
- *A private Git repository cannot be read by public hosted Actions:* choose the local builder; do not make source public without authorization.
- *An exploratory run has not been approved for paid service or private upload:* use `--dry-run` and report the needed approvals; do not assume `--budget` enforces a charge ceiling.
- *A run failed, stalled or leaked resources:* inspect provider status and real lease evidence, then invoke the supported cleanup path. Report actual output/cleanup evidence, not only transport acknowledgement.
