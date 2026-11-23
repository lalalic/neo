# Native Run Preflight Contract (pre-release preview)

The Rust preview implements only:

`neo-rs project run --dry-run --project NAME [--url HTTPS_URL | --path ABSOLUTE_RUN_DIR | --source SOURCE] [--dag NAME] [--title TEXT]`

## Invariants

- Reuse the configured independent Git Project root and private Run path rules.
- Validate canonical Project declarations, graph selection, allowed DAG inputs,
  HTTPS URL form, selected source brief, reviewable agents and versioning template.
- Treat symlink escape, traversal, invalid calendar dates, or source mismatch as
  errors **before** returning a successful preview.
- Exact JSON parity with Node reference for supported disposable fixture cases.
- The preview does **not** create `runs/`, Run bindings, Run Git history or Relay
  Jobs. A selected existing Run Git HEAD must remain unchanged.
- Explicitly reject actual Run execution, foreground, and project-defined JS
  preflight scripts; neither run them nor silently skip their required checks.
  Such projects do not qualify for a successful native dry-run yet.
- A built-in path without dynamic script preflight runs with Node.js removed
  from PATH (Git is still an external dependency for repository validation).

## Deferred completion gates

- Bound Run idempotency, exact file ownership, cryptographic immutable inputs,
  Run Git creation and recovery remain T014/T015.
- Durable Relay Job creation/activation, Coordinator input and Task identity
  validation must be tested with disposable fixtures before any live use.
- Project-owned JS preflight adapters need bounded time, output size, and
  explicit runtime dependency checks.
- No production launcher change or automatic compatibility fallback is allowed.
