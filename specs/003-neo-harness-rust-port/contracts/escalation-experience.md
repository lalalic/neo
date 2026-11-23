# Native sanitized Escalation Experience (T017 sub-slice)

The Rust `escalation_experience` module produces only sanitized, reusable
**Case summaries**. The canonical long-term Case store never contains
original Handoffs, raw tool commands, tool output, transcripts, credential
values or process logs. Original Handoffs are confined to the separately
private Challenge ledger for recovery.

## Record schema and protection

- Classifications are stable normalized category/strategy keys. Invalid,
  secret-like or overlong labels are replaced by a deterministic one-way
  Handoff digest fallback and safe runtime category. Outcome is one of
  `resolved`, `failed` or `needs_user`; Case identity is a SHA-256 digest of
  its scenario, outcome and strategy, matching the existing Node Case store.
- Scenario symptoms, verified lessons, check steps and failure explanations
  are redacted before persistence. The sanitizer strips credentials, bearer
  tokens, account emails, URLs, private paths, IP addresses, OTPs and long
  opaque identifiers, then enforces documented text limits.
- Tool observations contain only allowlisted tool names, call counts and
  failure counts. Raw tool arguments and tool outputs are ignored. Records
  include backend/engine/model **family only**, not full model repositories
  that might include private account or location fragments.
- The storage entrypoint validates the entire prepared record shape and its
  content-derived ID before opening a file. Unknown `handoff`/`events`
  fields, unmasked secrets, mismatched classification IDs, bad permissions,
  symlinks and arbitrary raw metadata fail closed.
- Directory modes are 0700; output is 0600, fsync'd and published via
  hard-link create-if-absent. Multiple threads writing the same identity
  produce exactly one immutable Case and explicit duplicate outcomes.

## Acceptance evidence (2026-11-23)

- Seven Rust integration tests passed, including **full semantic JSON
  equality** to the original Node `prepareExperience`, fallback/runtime-error
  cases, exact sanitizer parity for synthetic key/OTP/email/path/IP inputs,
  parallel atomic deduplication (12 writers), private modes, and rejection
  of raw Handoff/Events/unsanitized text before creating any Case directory.
- Original `node --test test/neo-escalation-experience.test.mjs`: **11/11 pass**.
- Full Rust integration suite **123/123 passes**; strict Clippy `-D warnings`
  passes. All data and storage were disposable synthetic fixtures. No real
  case library, inference model, messages or production service touched.
- The actual stateless local tool-calling execution, model startup/lifecycle,
  post-run model summarization and interactive learning remain outside this
  verified primitive and are **not yet integrated**. T017 remains open.
