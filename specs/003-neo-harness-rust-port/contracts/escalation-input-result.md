# Native local Escalation preflight, inference config and result contract

Rust's `escalation_contract` is a pure validation module. It does not start
models, call providers, write Challenge or Case state, notify people or run
model-authored tools. The remaining Escalation execution path must invoke
this module when its own lifecycle is ported, never bypass it.

## Handoff and execution prerequisites

- The only content input is `--handoff-file PATH` with optional
  `--on-needs-user-file PATH`, `--cwd PATH` and `--correlation-id ID`.
  Legacy inline intent/context and backend selection parameters fail closed.
- Handoff and override notification policy must be readable nonblank UTF-8
  files, at most 1 MiB. Without an override, the **versioned Harness**
  `agents/escalation-needs-user.md` policy is used.
- Correlation IDs must be opaque, 6–160 safe ASCII characters and may not
  include traversal-style `..`, `//`, embedded spaces or newline characters.
  Original handoffs remain unredacted **only** in the future private Challenge
  ledger; never put them in distribution manifests or public logs.
- The local inference engine is `llama`, `mlx` or `external`. Numeric budget,
  turn, context and startup ranges match the existing JS reference. External
  inference can connect only to `http://127.0.0.1:PORT/v1`.
- Owned `llama-server` command arguments retain one inference slot, Metal
  offload 99 layers, q8_0 KV cache and local-only host; GGUF model-file and
  Hugging Face repo selection match the Node reference exactly. No process
  is started merely by loading or validating this configuration.

## Model output verification

- Session results are parsed from JSON-lines events, not arbitrary text.
  `resolved` requires a successful real tool-result event and actual
  nonempty evidence; failed tool calls or a model's bare claim of success
  cannot satisfy the acceptance gate.
- The result is normalized to `status, summary, reason, user_action,
  evidence, notification`, with `resolved|needs_user|failed` statuses,
  required human action for `needs_user` and strict notification field types.
- A best-effort output sanitizer removes credential assignments, observed
  exact secret values, bearer tokens and high-entropy keys from summary,
  reason, user-facing action, evidence and notification details. This is
  defense-in-depth; sensitive tool transcripts must never be persisted raw.

## Evidence (2026-11-23)

- Seven Rust tests pass: synthetic handoff, default and override policy,
  invalid/legacy argument rejection, Node-equivalent default/override
  engine settings and Metal server argv, loopback-only endpoints,
  Node-equivalent result normalization, non-hallucinated success gate and
  synthetic credential redaction. No actual model or tool was started.
- Full Rust tests: **107/107**, strict Clippy with `-D warnings` passed.
- Real isolated Rust Relay Job smoke failed once with a transient CLI exit 1;
  the independently repeated same script passed: one ACTIVE Job, stable
  Job/Task IDs, one SQLite Job, foreground attached, stable Run Git history
  and no production state touched. No claim of uninterrupted first-run PASS.
- Local Escalation **execution and recording remain unported**: T017 stays
  open until model process lifecycle, stateless tool adapter, durable Attempt
  ledger, best-effort redaction integration and terminal recovery all pass.
