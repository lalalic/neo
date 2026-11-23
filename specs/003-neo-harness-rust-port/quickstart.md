# Quickstart: Rust Harness Migration

From the dedicated worktree on branch `rust`:

```sh
cd /path/to/neo-harness-rust-worktree
git branch --show-current                       # rust
export SPECIFY_FEATURE_DIRECTORY=specs/003-neo-harness-rust-port # first time in a new checkout
node --test test/neo-agent-catalog.test.mjs       # reference
cargo test --workspace                            # native tests
cargo run -q -p neo-harness-cli --bin neo-rs -- agent list --source shared
node .bin/neo.mjs agent list --source shared
```

Compare `agent list` and `agent search` with the same filesystem and
environment. Test negative arguments, missing required Agency directory and
`--project` resolution using temporary fixtures.

The preview command must remain separate from the installed `neo`.
Do not use `neo project run` against production Projects during the
first read-only migration slice.

Before any production cutover, also run Node-free shell invocation, initial
bootstrap in JSON and Markdown, safe disposable Project Run lifecycle,
failure recovery, and installed Neo.app native distribution validation.
See `contracts/agent-cli.md` and `contracts/migration-parity.md`.

## Verified Slice-A Evidence — 2026-11-23

- `cargo test --workspace --offline`: **6/6 native integration tests pass**.
- `cargo clippy --workspace --all-targets --offline -- -D warnings`: pass.
- Rust native Agent list/search compared with Node on the live local catalog:
  **291/291 entries equal**, Agency **283/283**, shared **8/8**, and two
  ranked search cases equal.
- Explicit relative Project paths and a Node-free PATH are covered by tests.
- Existing Node Agent unit tests: **4/4 relevant behavior cases pass**.
- Existing Node distribution staging case **fails identically on unchanged
  `main`**, because `scripts/stage-neo-cli.mjs` rejects the already-tracked
  `skills/iphone-helm` symlink (`120000`). This is a **pre-existing
  baseline blocker**, not a Rust regression. It is not fixed in this slice.
- Native candidate remains preview-only. `neo bootstrap`, `neo project run`,
  and all other non-Agent commands remain unimplemented in `neo-rs`; the
  current production Node.js CLI remains the authoritative implementation.

### Spec Kit Consistency Review

All 10 functional requirements and five measurable outcomes have corresponding
future or completed task coverage. The initial read-only slice satisfies the
constitution's ownership and no-dual-write gates. No unresolved questions or
unapproved exceptions; full release gates remain deliberately open.

## Verified Read-only Slice (T010–T012) — 2026-11-23

- `cargo test --workspace --offline`: **15/15 integration tests passed**.
- `cargo clippy --workspace --all-targets --offline -- -D warnings`: passed.
- Native `skill list`: **51/51** real entries, including dependencies and paths,
  structurally identical to Node + Python baseline.
- `bootstrap --json`: JSON-equal; `bootstrap`: **32,967 bytes identical**
  to the existing Node.js rendition on this machine.
- Native `workspace show`: JSON-equal; real `project list`: **14/14** independent
  Project entries JSON-equal; `project resolve content-distribution`: JSON-equal.
- Native `status` and `doctor`: JSON-equal and exit-code equivalent during live
  reference comparison. Until the final cutover, these preserve the legacy Node
  and Python dependency diagnostics; update that contract deliberately during
  release staging, not as an accidental language-port behavior change.
- Explicit fixture parity covers duplicate names, missing Skill prerequisites,
  project-specific discovery, malformed arguments, missing bootstrap rules,
  project symlink exclusion, invalid workspace configuration, and diagnostics.
- `skill list`, `bootstrap --json`, and `agent list` pass with Node excluded
  from PATH. `status` and `doctor` remain diagnostic probes, not core execution
  dependencies.
- Only the preview binary changes. Running `project run` remains unsupported
  until disposable Project/Run safety and delegation tests pass.

## Verified Project Run Safety Slice (T013, T014 foundation) — 2026-11-23

- `cargo test --workspace --offline`: **27/27 integration tests pass**
  (6 Agent + 5 Skill/Bootstrap + 4 read-only + 5 Project/Run safety +
  7 native dry-run cases).
- `cargo clippy --workspace --all-targets --offline -- -D warnings`: pass.
- The Rust preview returns reference-equivalent JSON for supported isolated
  URL, canonical Run-path, named DAG, Discovery Source, and safe versioning
  templates. No private user project or Relay runtime was mutated.
- Disposable Run Git test verifies the same HEAD and clean status after
  validating existing private Run paths.
- A native dry-run passes with `PATH=/usr/bin:/bin` (Git available; Node
  unavailable); project-owned JS preflight intentionally fails closed.
- Node regression: **67/68 pass** across Project Run, Run Git, CLI Control and
  Bootstrap tests. The one failing test is the previously-confirmed baseline
  staging issue: tracked `skills/iphone-helm` symlink rejected by
  `scripts/stage-neo-cli.mjs`; it also fails on unchanged `main`.
- No `project run` actual execution, Run binding, relay submission, release or
  package install was attempted. See [Run Preflight Contract](contracts/run-dry-preflight.md).

## Native Run + real Rust Relay (T014–T016) — 2026-11-23

- `cargo test --workspace --offline`: **39/39 integration tests pass**.
- `cargo clippy --workspace --all-targets --offline -- -D warnings`: pass.
- Rust/Node bidirectional Run resume, byte-equivalent private inputs, private
  URL token redaction, source JSON order and tamper rejection are covered.
- Two concurrent native CLI calls to the same private Run create exactly one
  Relay Job, using OS directory flock instead of a persistent lease.
- Real Rust Relay and actual SQLite verification is repeatable with:

  ```sh
  node scripts/verify-rust-relay-isolated.mjs /absolute/path/to/agents-relay
  ```

  Evidence: `passed:true`, Job ACTIVE, second Run ACTIVE with unchanged numeric
  Job/Task identity, one isolated SQLite Job, unchanged Run Git HEAD. The
  isolated daemon is stopped and temporary assets removed after the test.
- This is the **common native Project Run** subset, not full command parity.
  T023–T025 cover advanced review, foreground and JS preflight variants.
- The installed Rust Relay distribution is missing its
  `owned-process-supervisor` binary. Test driver copies the existing Rust
  supervisor into a temporary test bundle; product installation is untouched.

## Specialty Project Run policy (T023) — 2026-11-23

- Private Vlog `--no-review` requires owner-approved private source-use and
  writes `review-mode.json` with publication forbidden (mode 0600).
- Interactive `review-stages.json` is validated against the selected DAG's
  `reviewableDags` (or Vlog's exact visioner/director/producer set). Selected
  Tasks receive explicit mandatory human-review policy; no automatic approval.
- After a Relay create failure, `--path` recovers the original unbound
  discovery source, its project-owned brief and original DAG, never silently
  reselecting or overwriting staged evidence.
- Four advanced Rust/Node fixture cases bring native Rust integration coverage
  to **43/43 passing**; `cargo clippy -D warnings` and real isolated Relay E2E
  also pass. The preview remains on `rust` only.

## Explicit project JS preflight + foreground Relay (T024) — 2026-11-23

- Project-owned script preflight only when `project.run.json` explicitly
  declares `preflight.script` under `scripts/*.mjs` inside the Git root.
  Rust launches Node **only for this extension**, 30s timeout / 1MiB
  captured stdout and stderr limit; rejects nonzero, missing runtime,
  out-of-project symlinks and excessive output before a private Run is created.
- Native `--foreground` emits Job/Task identity before invoking the existing
  Rust Relay CLI's `job run --foreground`. The CLI inherits the user's
  terminal for Task event streaming; no secondary scheduler or new Job.
  The OS Run directory lock is released before the terminal attachment.
- `cargo test --workspace --offline`: **50/50 integration tests passed**;
  strict Clippy with `-D warnings` passed.
- Real isolated Rust Relay daemon E2E: ACTIVE -> same ACTIVE identity on
  replay, `foregroundAttached:true`, exactly one SQLite Job, unchanged Run
  Git HEAD and untouched production services.

## Project Run CLI parity matrix (T025) — 2026-11-23

- `neo-rs project run --help` and `-h` are **byte-identical** to Node; the
  source-derived help is compiled into the Rust binary (no Node at runtime).
- URL/path flag forms, malformed/duplicate options, Unicode title overrides,
  source evidence, numeric Job/Task IDs, named DAG immutability, prepared URL
  Runs and multi-stage publication Review are exercised against Node fixtures.
- `cargo test --workspace --offline`: **57/57 passing**; strict Clippy with
  `-D warnings`: pass.
- Real isolated Rust Relay E2E: `passed:true`, `foregroundAttached:true`,
  one Job ID/Task ID, one SQLite Job, stable Run Git HEAD.
- Node reference `node --test test/neo-project-run.test.mjs`: **38/39 passing**.
  Only `package staging includes the project run entrypoint` fails because
  the legacy Node staging script rejects the preexisting
  `skills/iphone-helm` tracked symlink. Rust release packaging is T018.

## Native NeoY MCP facade (T017 in progress) — 2026-11-23

- Rust `mcp tools`/`mcp call` and `computer-use help`/`computer-use call`
  use NeoY's **existing local loopback Gateway**, never new service ownership.
  MCP allows only preview/questionnaire tools; Computer Use retains its ten
  exact allowlisted commands. Unauthorized tools are rejected before network.
- Native fake-loopback protocol tests **7/7**; original Node MCP reference
  tests **12/12**; all Rust integration tests **64/64**, strict Clippy passes.
- Actual read-only NeoY `mcp tools`: Node and Rust JSON **identical**.
  Live Computer Use Help has the same ten commands. Its raw nested JSON key
  ordering varies between two Node calls; decoded semantics match Rust.
- MCP Token OAuth, escalation and remaining CLI are not yet ported. The
  installed `neo` and production NeoY remain unchanged.

## Native OAuth token client (T017 in progress) — 2026-11-23

- Implemented `neo-rs mcp token issue|revoke` as a Rust PKCE client of the
  **existing** NeoY HTTPS OAuth issuer. Verifier/state are cryptographically
  random; callback/issuer/state validated; one-hour access token is required;
  unused refresh credentials are revoked before returning any access token.
- Output-file mode uses exclusive `0600` creation and never prints secrets in
  metadata. Failures remove incomplete issuance files, while revocation errors
  preserve the original token file. Issuing to stdout requires explicit opt-in.
- **All OAuth tests used mock transport only**, not real operator credentials.
  Rust OAuth mock suite **7/7**, existing Node MCP+Token tests **17/17**,
  Rust full integration suite **71/71**, strict Clippy passed.
- Escalation and other core CLI coordination remain T017 open. No production
  token issuance, credential read, install or service restart occurred.

## Native service manager facade (T017 in progress) — 2026-11-23

- Rust `service list|status|start|stop|restart` uses existing PM2 and
  native NeoY launchd, not a second service scheduler.
- Live read-only service inventory is **exactly equal** to Node (10 entries).
- 3 fake PM2/launchctl tests verify `--apply`, service-name fencing and native
  keepalive semantics; no real process start/stop/restart was performed.
- Native Rust tests **74/74**; original Node control tests **15/15**;
  strict Clippy passed. See `contracts/native-service-cli.md`.

## Native Rust Harness bundle (T018) — 2026-11-23

- `neo-rs package stage ABSOLUTE_NEW_DIR` creates a native binary, manifest,
  and only 188 committed Agent/Skill/GPU files. It excludes and records the
  single tracked external `skills/iphone-helm` symlink (no dereference).
- 4 package acceptance tests verified clean disposable Mac HOME, Node-free
  `workspace show`, `skill list`, `bootstrap --json`, `project list`, and a
  versioned `~/.local/bin/neo` symlink launcher. Agency Agents remains an
  explicit separately installed optional Agent Discovery prerequisite.
- Rust full suite **78/78**, strict Clippy and real isolated Relay E2E passed.
  Bundle is **a local preview only**; no actual production install or cutover.
- See [Native Packaging Contract](contracts/native-package.md).

## Native text-only Skill export (T017 in progress) — 2026-11-23

- `neo-rs skill package SKILL_DIR OUTPUT.zip` now produces a self-contained
  DEFLATE ZIP in Rust, without the original Python helper. Valid text-file
  archive members match the old packager. Hidden/binary/`node_modules` files
  and symlinks are not included. Exclusive output mode prevents overwrite.
- Disposable archive parity/security tests **3/3**; full Rust suite **81/81**;
  strict Clippy and real isolated Relay Coordinator E2E still pass.
- Local Escalation, Project TTS, Eval/GPU command routing remain unported.
  T017 stays open and the installed `neo` is untouched.

## Native Project TTS (T017 in progress) — 2026-11-23

- `neo-rs project tts --text ... --output /absolute/output.m4a|.wav`
  now runs in Rust, delegating only actual synthesis to macOS `say` and
  encoding/probing to installed ffmpeg/ffprobe. No Node wrapper or new TTS
  service. The output is validated audio with exclusive private publication.
- Native tests **4/4**, including two real Chinese audio formats and failed
  engine cleanup; original Node TTS **4/4**, full Rust acceptance **85/85**,
  Clippy strict pass. See `contracts/native-project-tts.md`.

## Explicit Eval and GPU dynamic extension routing (T017 in progress)

- Rust dispatches `eval run|list|audit` and `compute|gpu` through their
  original tightly scoped Node extension scripts. The core binary never
  silently falls back to Node; a missing optional runtime is an error.
- The native distribution now bundles four committed Eval JS dependency
  files alongside its existing committed GPU sources.
- Five isolated/read-only parity tests pass, including Node Eval List and
  GPU services/help, a fake provider argv test, missing Node and invalid
  commands. Full Rust suite **90/90**, strict Clippy passed; no paid provider
  invoked. See `contracts/optional-eval-compute.md`.

## Native Escalation history (T017 in progress)

- `neo-rs escalation cases|challenges [--search ...] [--limit 1..200]`
  now uses Rust and the existing private on-disk record format.
- 5 synthetic fixture tests match Node JSON for filter/order, status and
  checkpoint handling, without writing or reading production history.
- Full Rust suite **95/95**, strict Clippy passed. Running a local model,
  writing Challenge Attempts, Escalation model locks, and cleanup are still
  unported, so T017 remains incomplete.

## Rust Escalation flock guardian (T017 in progress)

- The local inference-slot kernel flock is now implemented in Rust with a
  guardian child tied to the owner's pipe. It waits for the same lock inode
  as Node, has bounded timeout and terminates explicitly registered owned
  child PIDs before releasing the resource.
- 5 private temporary-process tests passed, including mixed Node/Rust lock
  contention and orphan-pipe cleanup; full Rust suite **100/100**, strict
  Clippy passed. No live `llama-server` or production model-lock use.
- **Escalation execution is not migrated yet.** The guardian is a verified
  library primitive awaiting native model runtime and ledger integration.

## Native Escalation input, model and output contracts (T017 in progress)

- Added pure Rust Handoff/default notification policy parsing, safe runtime
  settings and model argument construction, plus result evidence gating,
  normalization and synthetic credential redaction.
- Seven reference/negative tests passed; full Rust suite **107/107**, strict
  Clippy passed. Isolated real Rust Relay E2E encountered one transient
  create-exit failure, then a fresh run passed with one ACTIVE Job and stable
  Run Git/foreground evidence. No production state changed.
- The actual Escalation stateless execution, durable Attempt writes and
  self-test/learning paths remain T017 open; no production cutover.

## Native durable Escalation Challenge writer (T017 in progress)

- Added native private Challenge/Attempt storage with Node-compatible stable
  Challenge IDs, original Handoff preservation, atomic 0600 start/checkpoint/
  finished evidence, retry handling and classified errors. Records cannot
  be silently overwritten; tampered identities fail closed.
- Nine synthetic Node/Rust fixture parity/security tests passed, original
  Node Challenge regression **8/8**, full Rust integration suite **116/116**,
  strict Clippy passed. No production Escalation data, model or notification.
- The actual local stateless tool-calling execution, dynamic server ownership,
  Experience learning and end-to-end terminal recovery are not yet integrated;
  T017/T019/T020 remain open and production `neo` is unchanged.

## Native sanitized Escalation Experience writer (T017 in progress)

- Added redacted, deduplicated private Case preparation/persistence. It stores
  only normalized scenario/steps/verification and tool counters, never raw
  Handoffs, transcripts, tool outputs or account secrets.
- 7 Rust Node-parity/privacy tests, 11 original Node Experience tests, full
  Rust suite **123/123**, strict Clippy passed. No production record touched.
- The stateless local inference loop, owned model startup, post-run summary
  and interactive teaching flows are still T017 work, not accepted as done.

## Native stateless local inference state machine (T017 in progress)

- Rust now implements the model-message/Tool Call/Tool Result/Decision Gate
  loop. It uses only localhost HTTP, <=4 tools per batch, no arbitrary tool
  names, no persistent transcript and a real successful-tool evidence gate.
  Tool executors are explicit callbacks; none are wired to production yet.
- Seven native mock/loopback tests and six original Node tests pass. Full
  Rust integration **130/130**, strict Clippy pass. No live commands, model
  startup, credentials, external network or production state were used.
- Still outstanding: authorized stateless Tool Executor, owned model runtime,
  Challenge/Experience integration and local model end-to-end acceptance.
  T017/T019/T020 remain open.

## Native Tool Executor and owned process-group cleanup (T017 in progress)

- The Rust stateless Tool Executor now delegates Shell/WebHelm/Computer Use
  to existing local interfaces. Apple sign-in field fill is **disabled by
  default** and can only be activated by a trusted explicit caller setting.
- Structured WebHelm JS uses stdin, never argv; model tool subprocesses use
  bounded capture and an owned process group for timeout/pipe cleanup. Owner
  Apple `USER_ACCOUNTS`/`USER_PASSWORDS` are not inherited by tool children.
- 11 isolated Tool Executor tests, all Rust **141/141**, Node model/MCP
  **18/18**, strict Clippy pass. No real Apple/browser/tool writes were made.
- Still outstanding: native owned-model lifecycle, terminal orchestration,
  failure recovery and full local-model E2E. T017/T019/T020 remain open.

## Native end-to-end Escalation command (T017 in progress)

- Native `neo-rs escalation --handoff-file ...` now covers original Handoff,
  persistent Challenge first, flock guardian, external or owned llama/MLX
  model, tool/decision loop, sanitized Experience and Finished Attempt.
- Owned model is isolated by process group and private temporary diagnostics;
  both normal and abnormal termination release the single existing lock.
- Full Rust 156/156; Node reference Escalation 41/41; strict Clippy and fmt
  pass. Synthetic E2E included real localhost HTTP, a temporary Shell action
  and an owned fake server; **no real model or production tool called**.
- `escalation learn|test`, model-generated Case fallback lessons and final
  phone/device E2E are still open; T017/T019/T020 not marked complete.
  See `contracts/native-escalation-runtime.md`.

## Native Project setup-agent (T017 in progress)

- `neo-rs project setup-agent NAME` now opens the same encoded ChatGPT
  browser setup URL as Node, with an absolute checked `setup/bootstrap.md`.
  It never submits the prompt automatically. The real Chrome launcher is
  **not** invoked in tests.
- Four native tests, all Rust **160/160**, original Node Control **15/15**,
  strict Clippy passed. See `contracts/native-project-setup.md`.
