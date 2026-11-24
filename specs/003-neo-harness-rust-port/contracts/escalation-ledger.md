# Native Rust Escalation Challenge/Attempt writer (T017 sub-slice)

Rust `escalation_ledger` implements the original private Challenge/Attempt
storage format, without starting a model, changing the installed `neo`, or
writing to any user-owned live Escalation directory during acceptance.

## Durable storage and recovery

- A Challenge ID is SHA-256 of `neo-escalation-challenge-v1\0` plus either the
  validated correlation ID or SHA-256 of the exact original Handoff. The first
  Challenge record stores the full **original, unredacted** Handoff, Goal,
  Blocker, Progress and Acceptance summaries; it remains immutable across
  retries. When an authorized retry changes the Handoff, only the new
  Attempt start event carries that changed text.
- Each new Attempt gets a fresh UUID and an immutable `started` event;
  preflight, model, agent, cleanup and other known stages update only one
  `checkpoint` event. A terminal `finished` event records the exact outcome,
  relevant evidence/notification/observation and classified failure. The
  checkpoint is removed after the terminal event, so incomplete/crashed
  attempts remain distinguishable from finished ones.
- The root and Challenge leaf must be real `0700` directories; files use
  exclusive private `0600` scratch writes, fsync and atomic hard-link
  publish. Checkpoint updates use atomic rename. No overwriting previous
  Challenge/Attempt records or following symlinked records.
- A retry validates existing Challenge ID/correlation/handoff and start-event
  identity before writing new records. Unsafe or mismatched persisted evidence
  fails explicitly instead of mutating the original private state.
- Runtime error classification preserves the original known Node categories
  such as inference HTTP failure and model resource lock failure.
- This module is a verified storage primitive. The complete stateless Agent
  loop, model startup/shutdown, experience learning and ownership checks
  remain separate unported work in T017; nothing invokes a real model.

## Acceptance evidence (2026-11-23)

- **9/9 Rust integration tests** pass with exclusively generated private
  temporary data, including exact semantic JSON parity against the original
  Node Challenge writer for start, successful finish, human request, retries,
  checkpoint removal, error stage/code and immutable recovery semantics.
- Mutated Challenge/Attempt IDs, symlink attempts, nonprivate roots, duplicate
  Attempt IDs, invalid states and unsafe correlations all reject without
  creating a false finished result.
- Original Node Challenge tests `node --test
  test/neo-escalation-challenges.test.mjs`: **8/8 passing**.
- Full Rust native integration suite: **116/116 passing**;
  `cargo clippy --workspace --all-targets --offline -- -D warnings` passes.
- No production Escalation history was read or changed. No model, notification,
  deployment or production launcher was touched. **T017 remains open.**
