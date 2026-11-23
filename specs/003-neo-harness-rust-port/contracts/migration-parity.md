# Migration Parity Contract

## Baseline

- Current source of truth: `node .bin/neo.mjs`.
- Candidate: `cargo run -p neo-harness-cli --bin neo-rs -- <args>`.
- Compare user-visible behavior, not internal Node stack traces or object identity.

## Core Verification

1. Successful command: same JSON field names, values, array order, and exit 0.
2. Missing/invalid input: exit nonzero, actionable stderr, no success-shaped data.
3. Path safety: no traversal or symlink bypass and no mutation of unrelated roots.
4. Runtime independence: successful core command with a controlled PATH that
   contains no Node.js executable.
5. Packaging: versioned resource paths and expected architecture.
6. Migration exit gate: no command is replaced until its suite and corresponding
   real-user E2E pass; release remains separate.

## Known Risks

- JS `localeCompare` and Unicode collation can differ from Rust string order;
  compare fixtures, and choose explicit compatible collation before broad release.
- Error text may include platform-specific path messages; compare semantics
  rather than masking failure.
- Arbitrary project-specific scripts still require their declared runtime.
