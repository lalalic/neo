# Neo GPU — built-in Node.js module

A **project-owned Dockerfile** is all that is needed to define the application
runtime. Neo adds its shared Node.js service entrypoint and dispatches the
resulting image to GPU providers. The project does **not** implement HTTP,
a provider adapter, or a separate `neo-gpu` package.

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
neo gpu build                     # hosted GitHub Actions, publish versioned GHCR image
neo gpu services                  # show built service IDs/images
neo gpu run my-video-project \
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
use `neo gpu build --builder local` instead. The image is pushed to GHCR by
default; `--no-push` is for local-only smoke tests.

A build tag is derived from the source Git SHA, Dockerfile contents, and exact
Neo runtime hash. Both the source commit and runtime hash are checked on the
hosted runner. A later `neo gpu run` reuses that image without rebuilding it.

`neo gpu build --dry-run` and `neo gpu run ... --dry-run` do not spend or upload.
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

Provider CLIs are external service utilities, **not** a separate Neo GPU package.
The Neo GPU orchestration and container service are authored in Node.js.

## Testing

```sh
node --test test/neo-gpu.test.mjs test/neo-gpu-node.test.mjs
node .bin/neo.mjs gpu build --dockerfile gpu/examples/hello/Dockerfile --dry-run
```

Build execution on GitHub Actions and real HF/Vast GPU inference must be
verified separately; tests of the local service do not prove CUDA inference.
