# Explicit Eval/Compute JavaScript extension boundary

`neo-rs eval run|list|audit` and `neo-rs compute|gpu ...` are intentionally
**specialized optional adapters**, not the core Harness execution engine.

- Rust only validates the supported command branch, resolves one exact
  versioned extension asset below the active Harness bundle, and executes
  the locally installed Node runtime with user arguments as an array.
  There is no shell interpolation, arbitrary JS entrypoint, silent core
  fallback to Node, or reimplementation of Relay's authoritative graph parser,
  managedWorkerInput PromptBuilder, Codex evaluator or paid GPU providers.
- `eval list` is read-only. Real `eval run` remains the project-owned
  evaluator, writing its canonical private `.evals/reports/` evidence;
  `eval audit` remains its own Node source. Only explicitly selected Eval
  commands cross the runtime boundary.
- Compute continues to use its existing project/provider implementation,
  retaining `--allow-spend` and `--allow-upload` gates. Rust does not grant
  new paid-GPU authorization or fabricate dry-run success. Unknown commands
  are rejected before invoking a Node runtime or provider.
- A user without Node can still run all native Bootstrap, Skill, Project,
  MCP, TTS, and service commands. **Eval/Compute are explicitly unavailable**
  until Node is installed, and the error says so.
- The native bundle ships exactly four additional Git-tracked regular JS
  files needed by the Eval adapter:
  `scripts/eval-project-worker-prompts.mjs`,
  `scripts/audit-project-worker-evals.mjs`,
  `scripts/resolve-relay-cli.mjs`, `.bin/workspace-config.mjs`.
  The `gpu/` tree was already bundled as tracked files in T018. No untracked
  files, symlinks, credentials or actual project eval reports are packaged.

## Acceptance evidence (2026-11-23)

- Five Rust integration tests pass: genuine `eval list --project sample`
  agrees with original Node and creates **no** project report; genuine
  `compute --help` / `gpu --help` / `compute services` output matches Node;
  unsafe commands reject before invoking adapters; fake-Node argv capture
  proves no real GPU rental occurred; Node-missing optional adapter produces
  an explicit error while native core remains available.
- Four existing clean Mac distribution tests still pass with the additional
  tracked Eval JS assets. Rust entire integration suite **90/90** passes;
  strict Clippy with `-D warnings` passes.
- No production paid GPU calls, project Eval writes, external provider
  requests, credentials, installation or service restart occurred.
- T017 remains open for real local Escalation coordination and other core
  command parity; these adapters are deliberately not marked native-Rust
  business logic.
