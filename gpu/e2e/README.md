# One-Dockerfile GPU E2E fixture

`Dockerfile` creates a small Node.js application without CUDA, ML weights or dependencies. `fixture.mjs` implements both `NEO_GPU_MODE=batch` and `web`; the **Neo image wrapper**, not the app, implements the batch transfer protocol and web gateway.

- **Batch:** input `/neo/input/request.json` (`requestId`, `text`), output `/neo/output/result.json` (request ID, deterministic SHA-256 and byte count).
- **Web:** serves `/` and `/api/echo?nonce=...` on `NEO_GPU_APP_PORT=7860`. Verifies the Neo web cookie and provider Bearer token never reach the app.
- **Smoke/local:** `node --test test/neo-gpu-e2e.test.mjs` validates both modes with zero GPU spend.
- **Live HF Jobs + public web:** `node gpu/e2e/run.mjs --live --allow-spend --build` builds two immutable GHCR variants from the **same Dockerfile**, then runs real HF batch and browser tests. Use `--live` without `--build` to reuse already built services. When the fixture and shared runtime are unchanged, the runner can reuse previously published immutable images even after unrelated Neo commits. Default provider is HF `cpu-basic`, costing approximately $0.01/hour plus any private proxy overhead; this intentionally tests Neo's provider contract without renting an expensive GPU. It requires existing HF credentials and an active, trusted `gpu.qili2.com` gateway.

No network or charge occurs unless `--live` is passed. Both live paths require explicit `--allow-spend` at the underlying Neo CLI. Live sessions are bounded and auto-cleaned, and the final report records provider cleanup evidence. Web mode uses a 300-second test session; the separate policy unit tests verify the normal one-hour default (3600 seconds).

**Gateway credential prerequisite:** before a live public-web E2E, the persistent
Node gateway must be able to authenticate to the private HF proxy. On Neo
Master, its supported default is a 0600 token file at
`~/.cache/huggingface/token`. Do not commit, log or include it in an image.
The live runner now checks that file *before* creating a paid web Job. A shell
session's `HF_TOKEN` alone is not enough when the gateway runs as launchd.

## Automated free Docker-level E2E

GitHub Actions `.github/workflows/neo-gpu-e2e.yml` runs on GPU-related pushes
and pull requests. It uses the same `Dockerfile`, builds both `batch` and `web`
Neo wrappers with Docker Buildx, launches them locally, verifies upload/start/
SHA-256/result download and the web UI/JSON endpoint, then destroys the test
containers. **It never provisions HF Jobs or Vast.ai and uses no credentials.**

You can reproduce this on any host with Docker Buildx:

```sh
node gpu/e2e/container-smoke.mjs
```

For a full hosted-provider check, use the separately opt-in `run.mjs` script
only after the private HF gateway credential is configured. The public web
fixture is explicitly token-guarded and its test resources are removed after
verified provider cleanup.
