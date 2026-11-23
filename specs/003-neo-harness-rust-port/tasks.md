# Tasks: Neo Harness Native Rust Core

**Input**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`

**Tests**: Required for every command port. Test-first, Node reference oracle and native direct execution.

## Phase 1: Setup

- [X] T001 Create isolated `rust` worktree and bootstrap `.specify/` without modifying canonical main checkout
- [X] T002 Define constitution and generate specification, checklist, plan, research, data model, CLI contracts, and quickstart under `specs/003-neo-harness-rust-port/`
- [X] T003 Establish baseline Node agent CLI tests and parity fixtures in `crates/neo-cli/tests/agent_cli.rs`
- [X] T004 Create minimal Cargo workspace and `neo-rs` entry point in `Cargo.toml` and `crates/neo-cli/`

## Phase 2: Foundational (blocking)

- [X] T005 Implement verified Harness assets root and local home/workspace path resolution in `crates/neo-cli/src/workspace.rs`
- [X] T006 Implement fail-closed CLI dispatch, stdout/stderr and unsupported-command handling in `crates/neo-cli/src/main.rs`

## Phase 3: User Story 1 — Native Discovery and Bootstrap (P1)

**Goal**: Native read-only CLI discovery without a Node runtime

**Independent Test**: `neo-rs agent list/search` matches the Node reference over project, global, shared and Agency fixtures

- [X] T007 [US1] Add failing fixture coverage for catalog precedence, search ranking, source filters and bad args in `crates/neo-cli/tests/agent_cli.rs`
- [X] T008 [US1] Port agent list/search to `crates/neo-cli/src/agent.rs` preserving JSON shapes and source order
- [X] T009 [US1] Run Node/Rust parity and native no-Node-PATH smoke tests; document evidence in `specs/003-neo-harness-rust-port/quickstart.md`
- [X] T010 [US1] Specify and port canonical Skill discovery to `crates/neo-cli/src/skill.rs` with parity fixtures
- [X] T011 [US1] Port bootstrap text and JSON to `crates/neo-cli/src/bootstrap.rs` with dynamic discovery and negative tests
- [X] T012 [US1] Port remaining read-only workspace, project list/resolve, status and doctor commands with reference comparisons

## Phase 4: User Story 2 — Project and Run Lifecycle (P2)

**Goal**: Safe native Run management preserving Relay ownership

- [X] T013 [US2] Add disposable Project+Run Git fixtures and invalid path/symlink regression tests under `crates/neo-cli/tests/`
- [X] T014 [US2] Implement Project resolution/declaration validation and Run binding without touching production Runs
- [X] T015 [US2] Implement Run Git and delegated Relay submission, including interruption/failure recovery
- [X] T016 [US2] Verify real disposable Project E2E and Run state preservation
- [X] T023 [US2] Port specialty `--no-review`, `review-stages.json`, and unbound discovery source recovery with full parity tests
- [X] T024 [US2] Support explicit bounded project JS preflight and Rust Relay `--foreground` attachment (no duplicate scheduler)
- [X] T025 [US2] Finish Project Run flag, source, error, and compatibility matrix before installation/cutover


## Phase 5: User Story 3 — Complete Native Distribution (P3)

**Goal**: Node-free core CLI, optional runtime only for explicit extensions

- [X] T017 [US3] Port MCP/token/escalation coordination and remaining native core CLI commands without duplicating other services
- [X] T018 [US3] Package Rust executable with versioned shared Agents/Skills and verify clean Mac installation
- [X] T019 [US3] Run full core CLI parity, node-free and existing Neo.app integration acceptance matrix
- [ ] T020 [US3] After explicit release approval and verification, replace installed launcher and remove superseded Node core code

## Final Phase: Review and Cleanup

- [X] T021 Audit completed command slices for safety, contracts, errors, and resource ownership
- [X] T022 Commit verified migration slices to `rust` only; preserve live main and unrelated work

## Dependencies and Execution Strategy

T001→T002→T003→T004→T005→T006→T007→T008→T009 form
the initial independent, read-only implementation slice.
T010–T012 complete P1; T013–T016 depend on P1; T017–T020 depend
on earlier slices and explicit release authorization. T021/T022
apply to each completed slice, but are not grounds to mark unfinished
features complete.

No work on this branch automatically changes the installed `neo` launcher.

### Verified P2 implementation boundary (2026-11-23)

T013–T016 are verified for the common Rust Project Run path: independent Git
Project, canonical path, private binding, source evidence, local-only Run Git,
Relay Job create/activate/reuse and deterministic recovery. OS kernel directory
flock serializes concurrent CLI processes; no lease row or stale lockfile.
12 Rust/Node live lifecycle tests confirm immutable files, numeric IDs, safe
resume, no duplicate Job, failure recovery, source privacy, byte-equivalent
private inputs and tamper rejection. The real Rust Relay isolated SQLite and
daemon E2E also passed with one ACTIVE Job and unchanged Run Git HEAD.

T023–T025 complete for the Project Run CLI contract: private Vlog and human
review stages, unbound source recovery, explicit bounded JS project preflight,
foreground attachment via Rust Relay (no duplicate scheduler), exact help text,
error/flag matrix, Job title, Coordinator numeric IDs, DAG immutability,
prepared URL and six-Stage Growth contracts. Separate Rust release packaging
and main-CLI cutover remain T017–T020. These are explicitly rejected
rather than silently skipped. The installed `neo` launcher is unchanged.

### Native bundle gate (T018) — 2026-11-23

Rust-native `package stage` is now verified via four clean temporary
installation fixtures, including a versioned symlink in a fresh HOME and no
Node/Python on PATH for core discovery. Git-tracked regular assets only,
explicit missing external link `skills/iphone-helm`, no secrets. This proves
staging and clean-room user-prefix launch **without** installing on the user's
production Mac. T017, T019 and T020 are still open; T020 requires explicit
release approval after complete command parity and integration evidence.

### Native core command and Escalation code gate (T017) — 2026-11-23

Native parity for MCP/Token/Computer Use, PM2/launchd, Project setup-agent,
Skill ZIP, Apple-safe Tool Executor, owner-taught learning, test-only nonce,
private Challenge/Experience storage, global flock, owned model group,
read-only self-test and post-run local classification has passed synthetic
and isolated integration evidence. Optional Eval/Compute remain explicitly
versioned Node adapters and are not silently claimed as native code.

**182 Rust integration tests**, **72 Node original reference tests** and
**4 clean Mac package tests** passed with strict Clippy and fmt. This proves
T017 implementation at code/fixture scope, not a real L3 owner account or
model-performance test. T019 must separately confirm live NeoY/installed
services and T020 still requires explicit release approval.

### T019 integration gate — 2026-11-23

Accepted read-only live CLI Node/Rust 14/14 and live NeoY Computer Use
integration; all 184 native tests, strict Clippy, fmt, Rust package 4/4;
real cached offline Qwen3.5 4B read-only tool/nonce E2E with model reaped;
and isolated Rust Relay Coordinator/SQLite/foreground E2E. Node's existing
tracked `skills/iphone-helm` symlink staging failure is unchanged and
recorded separately. Mandatory explicit `--preflight=true` is required by
current Relay for all new Jobs and cannot be autogenerated. See
`contracts/t019-integration-acceptance.md`.

T020 remains open and requires explicit production cutover approval.
