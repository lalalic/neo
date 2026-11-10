# Neo Compute — built-in Node.js module

`neo compute` is the primary public command. The old `neo gpu` command and
existing private `gpu/` runtime/state paths are preserved for compatibility.
The new public gateway is `https://compute.qili2.com` and the previous
`https://gpu.qili2.com` hostname is retained as an alias.

A **project-owned Dockerfile** is all that is needed to define the application
runtime. Neo adds its shared Node.js service entrypoint and dispatches the
resulting image to GPU providers. The project does **not** implement HTTP,
a provider adapter, or a separate GPU-specific package.

## Project contract (v1)

In the Dockerfile, define a `CMD` or `ENTRYPOINT` that terminates once:

- Inputs: files in `/neo/input/`; input names come from `--input NAME=LOCAL_PATH`.
- Outputs: files in `/neo/output/`; returned by `--output NAME=LOCAL_PATH`.
- Environment: `NEO_GPU_INPUT_DIR` and `NEO_GPU_OUTPUT_DIR` expose the paths.
- Log progress to stdout/stderr. Exit **0** only when all outputs are ready.
- The image must run on Linux/amd64 and support the injected Node 22 binary
  (glibc-based CUDA/Ubuntu/Debian images are supported; Alpine/musl is not).
- Jobs may run without network access; include required libraries in the image
  or use provider-specific read-only model mounts when available.

Neo builds the project Dockerfile, reads its `CMD`/`ENTRYPOINT`, then wraps the
image with `gpu/runtime/Dockerfile.wrap` and `gpu/runtime/service.mjs`. The
container exposes `GET /health`, `POST /inputs/NAME`, `POST /start`,
`GET /status`, and `GET /outputs/NAME`. HF Jobs provides a **token-authenticated**
proxy. Vast.ai uses SSH port forwarding; the HTTP port is not made public.
No project-specific service process or Python CLI is installed on Neo Master.

## Usage from another Git repository

```sh
cd ~/Workspace/my-video-project
# Dockerfile is committed and pushed to GitHub.
neo compute build                     # hosted GitHub Actions, publish versioned GHCR image
neo compute services                  # show built service IDs/images
neo compute run my-video-project \
  --input image.png=portrait.png \
  --input audio.wav=voice.wav \
  --output result.mp4=output.mp4 \
  --provider hf --budget 2 --max-seconds 1200 \
  --allow-upload --allow-spend
```

The default hosted builder uses the **Neo repository's GitHub Actions**, so the
project needs a GitHub remote with a *public* pushed commit and matching owner.
It is not possible for Neo's public Actions token to clone a different private
repo. For private or local-only projects, configure a Docker/Buildx builder and
use `neo compute build --builder local` instead. The image is pushed to GHCR by
default; `--no-push` is for local-only smoke tests.

A build tag is derived from the source Git SHA, Dockerfile contents, and exact
Neo runtime hash. Both the source commit and runtime hash are checked on the
hosted runner. A later `neo compute run` reuses that image without rebuilding it.

`neo compute build --dry-run` and `neo compute run ... --dry-run` do not spend or upload.
Real GPU usage requires `--allow-spend`; uploading local inputs additionally
requires `--allow-upload`. The `--budget` check is advisory and **not** a
provider-enforced hard billing cap. HF Jobs has a server-side `--timeout`;
Vast.ai has a separate Neo watchdog that destroys the rental at its deadline.

## Architecture

- `image.mjs`: builds/publishes images; service registry kept under
  `~/.config/neo/gpu/services.json` (private local metadata only).
- `runtime/`: the standard container service contract.
- `providers/hf.mjs`: HF Jobs scheduling and cleanup using the official `hf`
  CLI; uses authenticated HTTPS with no SSH or persistent Bucket.
- `providers/vast.mjs`: Vast.ai offer selection and cleanup using the official
  `vastai` CLI; uses SSH loopback forwarding, no public media endpoint.
- `transport.mjs`: input/output validation, transfer, and result checks.
- `watchdog.mjs`: independent Vast.ai cleanup if the invoking CLI exits.

Provider CLIs are external service utilities, **not** a separate Neo Compute package.
The Neo Compute orchestration and container service are authored in Node.js.

## Testing

```sh
node --test test/neo-gpu.test.mjs test/neo-gpu-node.test.mjs
node .bin/neo.mjs gpu build --dockerfile gpu/examples/hello/Dockerfile --dry-run
```

Build execution on GitHub Actions and real HF/Vast GPU inference must be
verified separately; tests of the local service do not prove CUDA inference.

## Default Hello Neo real-GPU smoke test

Use [Hello Neo](examples/hello-neo/README.md) to validate **actual CUDA execution**
without any ML model or CUDA Toolkit downloads. Its one small Dockerfile builds
batch and web versions that run a native PTX kernel (`40 + 2 = 42`) via the
provider's `libcuda.so.1`, then verify the result. On Neo Master:

```sh
node gpu/examples/hello-neo/e2e.mjs                          # no rental
node gpu/examples/hello-neo/e2e.mjs --live --allow-spend --build  # HF T4; publish once
node gpu/examples/hello-neo/e2e.mjs --live --allow-spend      # HF, reuse images
node gpu/examples/hello-neo/e2e.mjs --live --allow-spend --vast # Vast.ai, same images
```

The test registers `hello-neo-job` and `hello-neo-web`, verifies real GPU
computation in batch and the token-guarded public Web URL, then stops paid
resources. `hello-neo-web` remains registered but stopped for later use.
This differs from the CPU-only tiny E2E in `gpu/e2e/`, which validates
orchestration and transport without a CUDA device.

## Interactive web applications (`--mode web`)

A project may expose Gradio, Streamlit, ComfyUI or its own web UI. The project
Dockerfile's `CMD` must start a long-running HTTP server listening on the
configured port (default **7860**). Neo adds an internal Node wrapper on port
8000, handles the container lifecycle, and proxies HTTP and WebSocket traffic.
For example:

```sh
cd ~/Workspace/my-video-app
neo compute build --mode web --port 7860 --name my-video-app
neo compute web add my-video-app --provider hf --budget 2
# Prints the stable URL and a 256-bit random token ONCE.
neo compute web serve --port 8798
# https://compute.qili2.com/my-video-app/
```

The gateway is always on (no GPU billed when idle). A visitor authenticates
using the random per-service token before accessing any app traffic. It sets
an HttpOnly SameSite cookie and removes the credential from subsequent URLs.
**The token permits starting a paid GPU**, so keep it private. Rotate with
`neo compute web rotate SERVICE`. The browser must explicitly click **Start GPU**;
opening the link alone never rents one. The configured budget is an estimate,
not a hard billing limit.

**Automatic shutdown:** `neo compute web add` defaults to a **3600-second hard
session cap** measured from startup, regardless of user activity. A session
may configure a shorter cap (`--max-seconds`, 300–3600); longer sessions are
not allowed in web mode. HF Jobs gets an independent server-side `--timeout`;
Vast.ai has a detached watchdog that calls destroy while Neo Master is awake.
If Neo Master sleeps or loses connectivity, Vast deletion can be delayed until
it wakes; for provider-enforced maximum duration prefer HF Jobs. Sessions do
not auto-renew.
The gateway's Stop button and `neo compute web stop SERVICE` can end sessions early.

The app must support a base path (e.g. Gradio `root_path="/my-video-app"`) or
use relative asset URLs. Apps that hard-code root-absolute `/assets/...` paths
may fail under `/SERVICE/`; configure the framework's base/root path.

The gateway binds to `127.0.0.1:8798` and should be exposed only through a
TLS-terminating authenticated Cloudflare tunnel. Never expose the container's
port 8000 directly to the public internet. The gateway strips the user's Neo
gate cookie and provider credentials from traffic to the application, retaining
app-specific cookies for normal UI logins. HTTP and WebSocket upgrades are
supported. Token verification applies to both.

Inspect: `neo compute web status`; credential: `neo compute web token SERVICE` (local
machine only); rotate: `neo compute web rotate SERVICE`. Browser controls use POST
and verify Origin for CSRF protection. No app starts and no GPU is billed until
an authenticated user explicitly starts a session.

### Neo Master deployment (2026-11-10)

The GPU gateway LaunchAgent's `PATH` must include `~/.local/bin` (for the
Vast.ai CLI) and `/opt/homebrew/bin` as appropriate; macOS LaunchAgents default
to `/usr/bin:/bin:/usr/sbin:/sbin`. Without this, Vast Web SSH tunnel setup
fails even when an interactive shell can run `vastai`. Never store provider
credentials in a public plist.

The persistent gateway is a user LaunchAgent named `com.neo.gpu-web-gateway`
that runs `neo compute web serve --port 8798 --origin https://compute.qili2.com` on
**loopback only**. A separate `com.neo.gpu-web-cloudflared` LaunchAgent uses a
named Cloudflare Tunnel `neo-gpu-web`, avoiding modifications to NeoY's
app-generated tunnel ingress configuration. The public hostname is
`https://compute.qili2.com`; no GPU is rented simply because the gateway is up.

Operator-only state stays outside Git:

- `~/.config/neo/gpu/web/services.json` — per-service provider, budget and cap;
- `~/.config/neo/gpu/web/tokens/SERVICE.token` — 256-bit token (mode 0600);
- `~/.config/neo/gpu/web/cloudflared.yml` — tunnel ID and credentials-file path;
- `~/.local/state/neo/gpu/web/SERVICE.json` — current rental/deadline;
- `~/Library/LaunchAgents/com.neo.gpu-web-{gateway,cloudflared}.plist` — keepalive.

Verification: `launchctl print gui/$(id -u)/com.neo.gpu-web-gateway`,
`neo compute web status`, `curl -i https://compute.qili2.com/health`, and a browser
request to `/SERVICE/` without a token (must be rejected). `neo compute web token
SERVICE` retrieves the secret locally; do not put it in a URL or Git.

Vast.ai's cleanup watchdog cannot guarantee shutdown while Neo Master itself
is asleep or disconnected. HF Jobs is recommended for a strict one-hour
provider-enforced session expiration. No automated idle-time extension exists.

## Automated tiny Dockerfile E2E (batch + web)

One `gpu/e2e/Dockerfile` builds two service modes from the same dependency-free
Node.js fixture. Run the local, non-billing unit and dry-run verification first:

```sh
node --test test/neo-gpu-e2e.test.mjs
node gpu/e2e/run.mjs
node gpu/e2e/container-smoke.mjs   # local Docker Buildx; no HF/Vast rental
```

For a **real** HF Jobs provider E2E, including image publication, input/output,
HTTPS browser token guard, web proxy, and verified cleanup:

```sh
node gpu/e2e/run.mjs --live --allow-spend --build
```

Later reruns may omit `--build` when the immutable image matches the current
source commit. `--batch-only` and `--web-only` limit the live scope. The E2E
fixture uses HF `cpu-basic` (a real provider Job, *not* a GPU inference test),
short server-side deadlines, and a US$1 budget check per session. The web
fixture uses a 300-second test limit; the normal default 3600-second limit is
separately tested. No credentials are stored in the repository or the E2E
receipt. See [E2E fixture details](e2e/README.md).

CI additionally runs the single-Dockerfile container smoke suite via
[Neo Compute tiny Dockerfile E2E](../.github/workflows/neo-gpu-e2e.yml) on GPU-related
commits, covering both `batch` and `web` without provider credentials or cost.
