# Implementation Plan: Neo Harness Native Rust Core

**Branch**: `rust` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-neo-harness-rust-port/spec.md`

## Summary

Port Neo Harness's executable CLI and core coordination to Rust in independently
testable slices. Keep the existing Node.js CLI as the production reference while
a separate `neo-rs` binary gains command parity. Begin with read-only Agent
discovery, then Skill discovery/bootstrap, Project/Run management, gateway
clients/escalation, and managed distribution. Keep versioned Markdown and
extension-specific scripts outside the native core.

## Technical Context

**Language/Version**: Rust 2021 (installed rustc/cargo 1.99), existing Node.js ESM as fixture baseline

**Primary Dependencies**: Rust standard library, order-preserving serde_json, URL parser, UTC date handling, UUID and kernel flock; existing Git/Rust Relay processes only for their own capability

**Storage**: No new database; read existing user configuration/Markdown and preserve private Run Git

**Testing**: cargo test, Node `node --test` existing cases, deterministic cross-runtime CLI fixture tests

**Target Platform**: macOS (Apple Silicon first, supported Mac architectures before distribution)

**Project Type**: Portable CLI binary plus versioned Markdown assets

**Performance Goals**: Core discovery and bootstrap not slower than reference by >25% in representative warm-run comparisons; correctness before optimization

**Constraints**: No Node.js on core command execution path; no live deployment, no modification of user Runs, no new service trust boundary

**Scale/Scope**: Existing public `neo` CLI; staged read-only and stateful command groups

## Constitution Check

*GATE: PASSED before research, rechecked after design.*

- Observable CLI compatibility: Node.js binary remains the acceptance oracle,
  with exact fixtures and negative-case comparisons.
- Capability ownership: Relay/Models/NeoY stay independent. The candidate only
  performs Harness responsibilities.
- User-owned data: first slice is strictly read-only; later fixture Runs live
  outside production Projects.
- Slice-by-slice TDD: initial fixtures and integration tests precede parity claim.
- Native core / dynamic extension: no JS fallback in the candidate core CLI.

No justified exceptions are needed for the initial slice.

## Project Structure

### Documentation (this feature)

```text
specs/003-neo-harness-rust-port/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── agent-cli.md
│   └── migration-parity.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
Cargo.toml
crates/
└── neo-cli/
    ├── Cargo.toml
    ├── src/
    │   ├── main.rs
    │   ├── agent.rs
    │   └── workspace.rs
    └── tests/
        └── agent_cli.rs
.bin/                    # unchanged Node.js reference implementation
test/                    # existing Node.js tests and acceptance fixtures
.specify/                # reproducible Spec Kit scaffolding
```

**Structure Decision**: One minimal native CLI crate to begin, extracted by
capability only after substantive code demands it. No broad service framework,
persistent daemon, or duplicated Relay module. The preview binary is `neo-rs`
and does not replace `/opt/homebrew/bin/neo`.

## Implementation Stages

1. **Slice A (current)**: Characterize existing Agent discovery, then implement
   `neo-rs agent list/search` and negative cases, with cross-runtime comparison.
2. **Slice B**: Native Skill resolver, bootstrap JSON and text rendering using
   the canonical resource paths; preserve dynamic content and precedence.
3. **Slice C (Project Run verified)**: Native workspace and Project discovery,
   `project run --dry-run`, private Run binding, Run Git, native Rust Relay
   delegation, advanced Vlog policy, optional JS preflight, source recovery,
   named DAG, error/help parity and foreground attachment have passed the
   57-test Rust acceptance suite and real isolated Relay/SQLite E2E.
   Packaging, other CLI commands and actual cutover remain T017–T020.
4. **Slice D**: Native MCP/gateway client and escalation orchestration; retain
   existing external script runtimes as explicit extension dependencies.
5. **Release**: Package signed/managed binaries, verify Node-free clean Mac
   behavior, retire translated Node core only after authorization and evidence.

## Complexity Tracking

No constitutional exceptions. The temporary side-by-side executables are a
testing approach; they MUST NOT both write durable business state.
