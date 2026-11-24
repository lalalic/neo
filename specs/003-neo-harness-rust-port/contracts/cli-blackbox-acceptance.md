# Rust Neo Harness CLI black-box acceptance, read-only phase

**Target:** the actual `target/debug/neo-rs` executable on branch `rust`, not
Rust library APIs, unit tests, or a simulated CLI. The existing **production
Rust Relay remains unchanged**. The installed `/opt/homebrew/bin/neo` continues
to be the Node CLI and is never replaced by this test.

## Reproduce

```sh
cd ~/Workspace/.worktrees/orchestrator/neo-harness-rust
cargo build --offline -p neo-harness-cli --bin neo-rs
node scripts/verify-rust-harness-cli-blackbox.mjs --isolated-only
node scripts/verify-rust-harness-cli-blackbox.mjs
```

The test emits JSON with `passed`, `total`, `cases`, `failed` and `deferred`;
**no private command output, complete bootstrap prompt, tokens, history or app
list is printed**. A failed check exits nonzero. The Node reference is the
current source `.bin/neo.mjs`; live tests ALSO compare with the actually
installed `neo` from a neutral current directory. That neutral directory is
important: the older installed Node CLI can otherwise mistake the Rust
worktree for a user Project and mark shared Agents shadowed. Only the
independently installed Harness root path is normalized in those comparisons.

## Read-only guarantees

The script creates a disposable `HOME`, Git Project, fake provider commands and
staged distribution **before** taking its baseline file digest. It uses
synthetic Agent rules and Eval cases, plus explicit `NEO_ROOT` and `HOME`.
No real Relay Job, project Run, live service, rented GPU, platform upload,
MCP token or device write is created. The isolated checks fail if any command
changes files under the test HOME or Project. Deliberately executable fake
`docker`, `hf`, `vastai`, and `gh` write a sentinel if invoked; `compute
doctor` must detect their executable presence **without running them**.
`PYTHONDONTWRITEBYTECODE=1` prevents Python used by the legacy reference from
creating bytecode in the isolated HOME. Command invocations use distinct argv
array elements; never split a command string in zsh.

The only live calls are read-only: Workspace/Project/Agent/Skill discovery,
Bootstrap, MCP inventory, Computer Use `list_apps`, PM2/launchd inventory and
status, Escalation history bounded to one record, Compute inventory/doctor,
and Eval Audit. No reported private values or raw tool responses are included
in the test report. `eval audit` may legitimately exit `1` for missing eval
coverage; it is still a successful read-only inspection if its summary parses.

## Coverage

- Installation: stage Rust binary from tracked assets; empty-home Bootstrap;
  discover required core Skills; omit `iphone-helm` and `neo-use`; opt-in
after a standalone global Skill symlink and disappear when unlinked
- Project: fixture and live list/resolve, source URL `--dry-run`, missing,
  duplicate, or false Preflight rejection; ensure no private Run/Relay binding
- Agent/Skill/Bootstrap: source and installed Node parity, global and
  project scope, semantic search, canonical root relocation
- Eval: fixture `list`, DAG selection, `audit`, invalid option gating,
  report-writing path explicitly excluded
- Compute: services, doctor, Web status of absent registry, batch run plan,
  Docker/GitHub image build `--dry-run`, conflicting push flags, missing
  spending authorization; verify no provider processes or persistent state
- Escalation: bounded case/challenge read-only lookup and empty fixtures
- Service: read-only list/status and mutation argument validation **before**
  calling PM2/launchd (which may otherwise initialize HOME caches)
- Neo.app: real MCP tool inventory and Computer Use `list_apps` read-only RPC,
  without creating a UI Session or clicking the device

Node Eval's old DAG parser depends on the removed Node Relay implementation.
That specific test validates the native Rust CLI's DAG output directly, not
an obsolete Node parser import. This is not a Rust Relay migration test.

## Not yet tested by this phase

These commands are intentionally deferred to an explicitly separate,
controlled-write phase, with disposable local resources and necessary
owner authorization for cost or production effects:

| Area | Deferred black-box checks |
| --- | --- |
| Project | Actual `project run` create/attach/resume; `setup-agent`, TTS file |
| MCP | `mcp call` preview/askquestions, token issue/revoke |
| Computer Use | click/drag/type/set_value, UI side effects |
| Escalation | local model `test`, `learn`, live execution/attempt persistence |
| Eval | `run`, including `--dry-run` (writes reports and invokes PromptBuilder) |
| Compute | Docker build/push, HF/Vast jobs, Web add/start/stop/token/rotate, cleanup, real TLS/WSS |
| Service | start/stop/restart `--apply` |
| Distribution | Install/switch default `neo` and rollback on Neo Master |

**Release remains blocked** until the planned write-path E2E and authorized
production cutover. Passing this read-only matrix is not permission for cloud
spending, repository publication, UI writes or replacing the installed CLI.
