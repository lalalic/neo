# Research: Neo Harness Rust Migration

## Existing Behavior Inventory

- Production CLI entry: `.bin/neo.mjs`; installed `neo` currently starts a
  Node.js interpreter.
- Agent discovery: `.bin/neo-agent-catalog.mjs` parses only initial 16 KiB
  frontmatter of `*.agent.md`, merges project/global/shared/Agency catalogs,
  marks first matching name as effective and then orders the visible results.
- Workspace config: `.bin/workspace-config.mjs` validates
  `~/.config/neo/workspace.json` and the optional `NEO_ROOT` override;
  Harness source and Project root are separate.
- Bootstrap: `.bin/xchat-bootstrap.mjs` reads mandatory global rules and
  Harness bootstrap instructions, then transforms `neo skill list` into
  a stable JSON manifest and Markdown output.
- Project execution: `.bin/neo-project-run.mjs` guards independent Project
  roots and Run bindings. The actual durable Job owner is Agents Relay.
- Existing baselines: `test/neo-agent-catalog.test.mjs`,
  `test/xchat-bootstrap.test.mjs`, `test/neo-project-run.test.mjs`.

## Decision 1: Keep the Existing CLI as the Oracle

**Decision**: Build a separate `neo-rs` preview binary, comparing it to
direct `node .bin/neo.mjs` calls. Do not swap the installed launcher.

**Rationale**: Keeps the current daily agent bootstrap and production Harness
stable while tests uncover platform/path/ordering differences.

**Alternatives considered**: Immediate launcher replacement (unsafe without
coverage); dual-write implementation (creates inconsistent Run state).

## Decision 2: Small Rust Crate and Minimal Dependencies

**Decision**: Rust 2021 binary with `serde_json` for stable JSON shapes and
standard filesystem/CLI primitives. Add dependencies only for verified needs.

**Rationale**: The first implementation is local, read-only, and does not
benefit from a web server, framework or executor.

**Alternatives considered**: Tauri UI or bundled Node (does not remove core
runtime dependency); wholesale clone of Relay services (ownership violation).

## Decision 3: Resource Ownership

**Decision**: Use a resolved Harness assets root, keeping user
`NEO_ROOT` for Projects and global home directories for user definitions.
For development, allow an explicit assets-root override; production packaging
will provide verified bundled path discovery.

**Rationale**: Project paths must not be confused with shared Harness assets.

**Alternatives considered**: Embedding dynamic Skills into the binary (blocks
updates); deriving global agent assets from an arbitrary selected Project.

## Decision 4: First Slice Agent Discovery

**Decision**: Port list/search parsing and ranking with explicit errors,
frontmatter scope, source order and effective precedence. Compare JSON
structurally against real Node CLI outputs and disposable fixtures.

**Rationale**: High reuse in orchestration, independent read-only MVP.

**Alternatives considered**: Starting with `project run` (destructive safety
risk) or `bootstrap` (depends on full Skill resolution); starting with
`--version` alone (insufficient product value).

## Decision 5: No Hidden Node.js Fallback

**Decision**: A command not yet implemented in `neo-rs` returns nonzero
with a clear unsupported-command error, while the production `neo` command
remains unchanged.

**Rationale**: A hidden legacy fallback would mask unmet migration goals.

**Alternatives considered**: Proxying the full old CLI from Rust (false parity
and hidden runtime dependency).
