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
