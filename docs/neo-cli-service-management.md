# Neo CLI migration and service management (native Rust)

Scope: Source implementation in `lalalic/neo`, product identity owned by the existing native NeoY/Neo application. Does **not** create a new scheduler, MCP service, or GUI. Repositories and durable IDs stay separate.

## Current commands

```
neo status
neo doctor
neo project list
neo project resolve NAME
neo skill list [--project PATH]
neo skill package SKILL_DIR OUTPUT.zip
neo escalation --handoff-file PATH [existing options]
neo service list
neo service status NAME
neo service start|stop|restart NAME --apply
```

`neo` is the sole agent-facing entry point for project binding, skill discovery/packaging and escalation. Internal helper scripts are packaged as implementation details, not published as separate CLI commands. The skill resolver uses its bundled catalog instead of depending on `~/Workspace/neo`; `NEO_SKILLS_ROOT` is reserved for isolated tests.


## Service manager contract

- `neo service list|status`: read-only PM2 `jlist` plus the existing native NeoY launchd label `com.neox.neoy.keepalive`. Do not expose process environment, secrets, full PM2 configuration, or arbitrary launchd units.
- PM2 entries are returned with process-manager state (`online`/`stopped`/etc.), not asserted capability health. NeoY's launchd state is also process status, not full MCP federation health. Each service has `health:not_checked` until a real owner-specific probe is added.
- `start|stop|restart` only operate on exact, currently discovered service names; they require the literal trailing `--apply`. Invocations use argument vectors without shell interpolation. The CLI never restarts a service merely because it is stopped. A stopped optional watcher is not a failure.
- Native NeoY `restart` uses launchd kickstart and `start` targets the existing registered label; NeoY keepalive `stop` is intentionally refused instead of pretending an individual process kill stops the supervised service. Any full disable/upgrade must follow the native owner's lifecycle procedure.
- `neo status` tests only the local NeoY HTTP gateway landing response and optional Node/Python executables; `gateway_http:reachable` is **not** an assertion that MCP tools are healthy. `neo doctor` reports actionable missing dependencies. There is no automatic update, secret propagation, or service privilege escalation in this implementation.

## Native distribution and collision policy

The Rust CLI is the sole implementation. Build and stage the committed bundle:

```sh
cargo build --release --locked -p neo-harness-cli --bin neo-rs
NEO_HARNESS_ROOT="$PWD" target/release/neo-rs package stage /absolute/new/version-directory
/absolute/new/version-directory/bin/neo --help
```

Neo staging does not require Relay. Bootstrap and Eval require the independently installed `agents-relay` CLI on PATH (or the absolute `NEO_RELAY_EXECUTABLE` override) and a compatible JSON interface. Activate the verified binary through the existing owner-controlled launcher; never overwrite an unrelated executable. Roll back by restoring the previous native bundle link. Do not alter Relay state, browser profiles or credentials. Node and Python are optional for project-owned workloads, not core runtime dependencies. The separate Neo.app installer and remote host distribution need their own native migration.

## Acceptance

Run the Rust workspace tests, native black-box suites, isolated native package smoke and production read-only discovery. Container workload tests remain independent. Real provider rentals, UI mutations and remote-host rollout require separate verification and authorization.

## Agents Relay native automatic release

The existing `neo/package-service-updater` can opt into native Agents Relay
publication and activation. It reconciles durable Events Bus history every
15 seconds, keeping its cursor and pending work in
`~/.local/state/neo/native-auto-release.json`. It verifies the completed
Job and merged SHA using the Relay CLI and invokes the existing release
scripts; it does not change Job lifecycle. Publication and activation are
separate. Activation uses the native release idle/process gate, verifies
the served SHA and assets, and retains the existing rollback behavior.
Active Jobs are never paused or cancelled automatically. Retries back off
to at most two minutes; the updater resumes pending work after restart.

Create `~/.config/neo/native-auto-release.json` (owner-only permissions)
with canonical local paths and an explicit Events Bus starting cursor:

```json
{
  "repositoryRoot": "/absolute/Workspace/agents-relay",
  "packageRoot": "/absolute/.local/share/agents-relay",
  "autoPublish": true,
  "autoLive": true,
  "livePolicy": "when-idle",
  "startAfter": 12345
}
```

The example cursor must be replaced with the current durable Events Bus
cursor (GET `/events?order=desc&limit=1`). Only new merge events after that
boundary are eligible; to release an already-completed Job, set
`seedJobId` to its decimal-string ID on first enablement. If deliberately
including a reviewed post-merge hotfix, also pin the exact authorized
current main SHA as `seedSha`; the Job's merged SHA must be its ancestor.
Otherwise publication requires main to match a completed Job's merge SHA.
The publisher and activator also fence the selected SHA and prior live
revision. A later verified native publication can cover older merged Jobs.
No arbitrary commands or repository paths are taken from events.
Native publications are separate from the existing npm watcher.

Set both switches false (or remove the opt-in config) to stop new automated
actions; do not delete pending state or change its cursor to retry. The
existing PM2 service logs pending errors; verify release receipts and
`/api/version` for successful activation. Use
`serviceman restart --skill neo --service package-service-updater --apply`
after deploying updated updater source. No other repository is opted in by
default.
