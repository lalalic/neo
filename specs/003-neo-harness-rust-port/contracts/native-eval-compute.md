# Native Rust Neo Eval / Compute commands and acceptance

## Implementation boundary

All Neo CLI command families now have native Rust dispatch, including:

- `neo-rs eval run|list|audit`: strict Project `.evals/cases.json` schema,
  private reports, DAG role discovery, current Rust Relay `prompt --eval-file`
  managedWorkerInput, read-only `codex exec` decision checking, and a separate
  explicitly declared Node `.test.mjs` **project test workload** where
  necessary. Node no longer hosts the Eval CLI command. A standalone dry-run
  of the rebuilt non-production Rust Relay PromptBuilder in a disposable
  independent Git Project passed (canonical builder, Contracts, Contexts,
  isolated-eval marker and report creation; Codex was **not** invoked).
- `neo-rs compute services|doctor`: reads canonical private service registry
  and probes local prerequisites without renting equipment.
- `neo-rs compute build`: Git root, Dockerfile, pinned image identity and
  deterministic runtime hash validation, local two-stage Docker build,
  explicit `--no-push` that **never** performs `docker push`, or a hosted
  GitHub Actions build with immutable GHCR tags, explicit `--push`, verified
  workflow conclusion and persisted service registry. No shell-interpolated
  options. No fake success on missing Docker/GitHub CLI.
- `neo-rs compute run`: strict provider and price validation; input upload
  requires `--allow-upload`, paid creation requires `--allow-spend`, and
  budgets/timeouts are enforced before contacting providers. HF jobs use
  durable exact labels before create, strict cancellation by ID or exact
  label, and an independent deadline watchdog. Vast offers require verified
  hardware/reliability/pricing; native SSH loopback tunnel, provider cleanup
  and watchdog prevent indefinite billed orphaning after CLI exit. Create
  ambiguity is recorded, **never blindly retried**.
- Native `neo-gpu-v1` HTTP transport: bounded private upload, health,
  start, status, downloaded output hardlinked atomically without overwriting
  existing files, rejection and removal of incomplete downloads.
- `neo-rs compute web add|update|remove|token|rotate|status|start|stop|serve`:
  private 0600 bearer tokens, owner-only status, OS kernel `flock` per
  service, explicitly authorized paid starts, independent deadline watchdog,
  and reconciliation from verified lease cleanup. Native loopback HTTP
  gateway supports bounded control requests, HMAC-SHA256 signed short-lived
  cookies, strict same-Origin POST for paid actions, no browser action before
  token authorization, provider token isolation, TLS host authentication for
  HF, SSH loopback for Vast, HTTP reverse proxy and duplex WebSocket upgrade.
  Application cookies and redirects are rewritten to the service prefix;
  gateway cookie and spoofed forwarding-IP headers are **not** sent upstream.
  Upstream errors close a possibly-streaming connection instead of injecting
  a second false HTTP response.
- `neo-rs gpu` deliberately returns an error (obsolete alias). The old Node
  Compute/Eval CLI adapters are **not bundled**. Four tracked container
  wrapper files remain necessary for existing deployed image protocol.

## Verified tests and scope (2026-11-23)

- Complete native Rust workspace suite **220/220**, `cargo fmt --check`,
  strict `cargo clippy --workspace --all-targets --offline -- -D warnings`
  all passed. New Compute fixtures cover dry-run equality with Node, private
  service store, paid gating, exact-label provider reconciliation, native
  local Docker build `--no-push` and hosted GitHub workflow with fake
  executables, HF paid Web start/stop/verified cancel with fake provider,
  unverified Vast offer denial, private token/session lifecycle, no stale
  lock ownership, and gateway origin checks.
- Web gateway tests use a live disposable loopback listener for token login,
  forged cookie rejection, CSRF paid-POST refusal, token rotation, malformed
  length/transfer rejection; in-process socket tests verify upstream HTTP
  header and cookie rewrites, live bidirectional WebSocket traffic, and
  fail-closed TLS when a plaintext service impersonates HTTPS. No paid
  provider or public tunnel was contacted.
- Eval fixtures verify read-only listing vs Node, audit role coverage,
  managedWorkerInput via fake Rust Relay, fake Codex with actual subprocess
  IO, report persistence and invalid-case rejection. A **real local Rust
  Relay debug binary** successfully processed `prompt --eval-file` with a
  private temporary Git Project without starting a real Codex session.
- Live Node-vs-Rust read-only CLI matrix **14/14** passed; isolated real
  Rust Relay SQLite/Coordinator/foreground E2E passed with an independent
  private loopback Events Bus history reader. The fixture returns **zero
  invented events**, valid cursor 0, and does not touch production SQLite.

## Remaining release verification, not test claims

- **No Docker daemon was installed on the tested Neo Master host**; the
  two-stage local image build was tested with fake `docker`. Actual Docker
  build and workload container runtime are not yet physically verified.
- **No real paid HF or Vast resource was rented**; provider API and
  cleanup/billing safety were tested with isolated mock CLIs. Full real
  provider upload, HTTP/TLS/WebSocket, billing caps and teardown require an
  explicitly approved paid-service acceptance window.
- The **installed production Rust Relay binary** currently has a stale
  embedded contract-file path into a deleted worktree. The rebuilt local
  Rust Relay CLI works. T020 release must rebuild/verify the installed
  canonical Relay PromptBuilder before switching the Neo CLI launcher.
- Graph role selection in native Eval is conservative `agent:role` label
  discovery. The production Rust Relay remains the authoritative graph
  validator for actual Job execution; a passing Eval smoke does not replace
  full DAG contractual validation.
- Project-specific JS preflight/tests and existing Docker-internal JS
  execution remain external workloads; no claim of system-wide Node removal.
- T020 remains **unapproved**. Do not merge, replace live `neo`, change
  production services, remove Node source code, rent paid resources or
  claim final release completion on the basis of fixture-only validation.
