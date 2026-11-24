# Rust Neo Harness CLI controlled-write black-box acceptance

**Stage:** disposable local writes only, after the separate 58-check
read-only [CLI matrix](cli-blackbox-acceptance.md). Neo.app and the existing
production Rust Relay are **not upgraded, restarted, or replaced**. The test
calls the actual native `neo-rs` binary, not Rust library functions.

## Reproduce

```sh
cd ~/Workspace/.worktrees/orchestrator/neo-harness-rust
cargo build --offline -p neo-harness-cli --bin neo-rs
node scripts/verify-rust-harness-cli-write-blackbox.mjs
```

The controlled-write driver creates its own temporary `HOME`, Git Project,
Eval manifest, fake Codex and GPU provider commands, and an **in-process**
loopback JSON-RPC endpoint with synthetic tool responses. The real installed
Rust Relay PromptBuilder is read-only and uses fixture inputs and synthetic
Project files. The existing `verify-rust-relay-isolated.mjs` child acceptance
creates a separate temporary Rust Relay SQLite/daemon (no production database
access), creates exactly one Job, verifies resume and foreground attachment,
and rejects obsolete caller `--preflight` options before binding. The validated DAG supplies the Relay-internal flag (main 0141644 contract).

## Behavioral gates

- Skill `package`: CLI creates a 0600 ZIP; safe UTF-8 entries match the Node
  reference; it excludes symlinks, binary files and `node_modules`; it cannot
  overwrite an existing output. **Security difference found:** the legacy
  Node packager follows an external Skill symlink and packages its target.
  Rust correctly omits this unsafe entry. This is intentional *safer* behavior,
  not a parity regression; do not copy the legacy vulnerability into Rust.
- `eval run --dry-run`: uses the installed **Rust Relay** `prompt --eval-file`
  and generates a private 0700 report directory and 0600 report/prompt files,
  with `executed=0` and no Codex invocation or production Job.
- `eval run`: chooses the fixture Codex executable (no model service or
  network), checks actual valid decision output, rejects wrong decisions with
  nonzero exit and `FAIL` report, and runs an explicitly declared project
  Node `.test.mjs` workload as a test runner (not the Neo CLI implementation).
- `mcp call askquestions`, `review.preview`: actual native CLI JSON-RPC
  `tools/list` and `tools/call` dispatch against the local test server only;
  `isError:true` becomes exit code 2, and a nonallowlisted tool is rejected
  before making a request. No real browser preview or user notification.
- `mcp token issue`: the invalid-HTTP-origin failure path must delete the
  tentative private output token file and perform no network call. **No real
  OAuth token is issued/revoked in this phase.**
- `compute web`: fake locally published service supports add/status/token/
  rotate/remove; tokens remain in the private fixture HOME, rotation changes
  the credential, and start without `--allow-spend` is refused. Deliberately
  executable fake provider commands must never be invoked; no GPU is rented.
- Rust CLI → actual Rust Relay daemon: new Job `ACTIVE`, resume uses unchanged
  Job/Task IDs and Run Git, foreground attaches; SQLite has exactly one Job,
  with missing/false Preflight rejected and no Run binding. No Worker model
  executes, so this **does not assert Task/Job completion**.

The report contains PASS/FAIL labels and sanitized failure reasons. It never
prints full Eval prompts, synthetic token values, OAuth operator data, or
private JSON-RPC content. The entire fixture is removed on exit.

## Still outstanding before default CLI replacement

1. Actual HTTPS OAuth issuance/revocation using explicit test credentials and
   isolated local issuer; current tests cover token CLI validation and the
   internal OAuth protocol, not the full real CLI round trip.
2. Real Neo.app UI preview, Computer Use, and `project setup-agent` browser
   handoff under a dedicated session/authorization; not part of this phase.
3. Run Worker completion and final review through a disposable controlled
   Project using the installed Rust Relay; this phase validates create,
   resume, foreground, and preflight only.
4. Real Docker build, GitHub push, HF/Vast paid job lifecycle and live TLS/WSS
   Web proxy. Requires suitable Docker host and explicit spend/upload consent.
5. Controlled production launcher install, rollback, and release approval.

These are deliberate **not-tested** gates, not PASS by extrapolation.
