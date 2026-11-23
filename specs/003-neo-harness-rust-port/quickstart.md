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
