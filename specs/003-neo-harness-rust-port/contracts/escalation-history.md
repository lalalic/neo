# Native read-only Escalation Case/Challenge history (T017 sub-slice)

`neo-rs escalation cases [--search TEXT] [--limit 1..200]` and
`neo-rs escalation challenges [--search TEXT] [--limit 1..200]` now read
existing durable local records directly in Rust without requiring Node or
starting an inference server. This **does not** imply the mutating Escalation
runtime, cleanup or lock has been migrated.

- Case records use the original `NEO_ESCALATION_CASES_DIR` or default
  `~/.local/share/neo/escalation/cases` directory, 64-hex `.json` names,
  version 1 and known outcomes. Invalid or malformed untrusted JSON fails
  explicitly; no history is created on a read-only request.
- Challenge records use the original `NEO_ESCALATION_CHALLENGES_DIR`
  or default challenge directory, require private real `0700` storage,
  and accept only matching immutable challenge/attempt files. Finished
  attempts suppress their obsolete checkpoint. Events are ordered by
  timestamp, attempt ID and started/checkpoint/finished status; searches and
  limits preserve the original read-only semantics.
- Symlinked challenge root files, unsafe paths, invalid limits and
  unknown flags are rejected without any model call or directory creation.
  Plaintext original handoff content belongs to the private local ledger;
  never publish it, stage it in the Harness distribution, or log it as
  public integration-test evidence.

## Evidence (2026-11-23)

- 5 Rust tests passed: fixture Node/Rust output equality for Case and
  Challenge filtering/order, finished-checkpoint exclusion, read-only missing
  roots and invalid input/symlink rejection. Only synthetic fixture content.
- Full Rust integration suite **95/95** and strict Clippy `-D warnings`
  passed. No real historical private files were accessed or changed.
- The **local Escalation execution path remains unavailable in Rust** until
  lock, model ownership, stateless tool loop, failure ledger persistence,
  redaction and terminal verification are independently ported and tested.
  T017 remains open; no production launcher installation is authorized.
