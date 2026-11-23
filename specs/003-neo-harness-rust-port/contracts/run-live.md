# Native Project Run / Relay Contract (supported common subset)

`neo-rs project run --project NAME --path ABSOLUTE_RUN` supports real creation
and recovery. HTTPS `--url` and project-declared discovery `--source`/`--dag`
are also implemented; `--dry-run` remains strictly nonmutating.

## Sequence and ownership

1. Validate canonical independent Git Project, declaration, Graph, safe source,
   HTTPS input, Run path and Run Git template before mutation.
2. Acquire exclusive OS `flock` on the Run directory itself. This has no lease,
   database lock, stale lockfile or timeout authority. The OS releases the lock
   automatically when the CLI process exits.
3. Compare existing immutable Run input files before creating any missing
   files. Publish new files atomically by exclusive hard link, mode `0600`;
   new Run directories use mode `0700`.
4. Ensure independent local Run Git, reject remotes, symlinked metadata and
   unexpected staged files; preserve existing HEAD and ignore `.ghost.*`.
5. Submit one DRAFT Coordinator Job/Task to the **existing Rust Agents Relay**.
   Validate numeric Job/Task receipt, then create an immutable private binding.
6. Re-read authoritative Job/Task, verify repository, Project root, exact Task
   input and Graph bytes and output file path. Activate DRAFT through Relay;
   reuse ACTIVE/COMPLETED without duplicate submission.
7. Preserve the binding and private files on Relay failure. Restart verifies
   stored identity and rejoins the original Job. COMPLETED returns reused=true.

## CLI process boundary

- Default external executable: `agents-relay` (Rust).
- `NEO_RELAY_EXECUTABLE`: explicit test/installation override.
- `NEO_RELAY_CONTROL_PORT`: explicit isolated loopback daemon port override.
- `NEO_RELAY_CLI`: deprecated Node shim deliberately rejected.
- External calls have a 120-second timeout and 4 MiB stdout/stderr limits.
- Core Rust commands never silently invoke Node or Python.

## Verification

`cargo test --workspace --offline` has 39 passing integration tests. Twelve
Rust/Node live lifecycle cases verify exact canonical input bytes (with test
paths normalized), bidirectional binding reuse, private URL token handling,
source JSON key order, DRAFT activation recovery, completed Job reuse, tampered
Task/Source/binding rejection, no-remote Run Git and concurrent single-Job
creation via the kernel directory lock.

Use the repeatable real-daemon acceptance test:

```sh
node scripts/verify-rust-relay-isolated.mjs /absolute/path/to/agents-relay
```

The Node script is **a test driver only**. It builds `neo-rs`, copies Rust
Relay binaries and its supervisor to a temporary directory, initializes a
blank SQLite with Relay's checked-in schema, and starts a separate daemon on
a nonproduction port. It submits one real Coordinator Job, resumes it, checks
one SQLite Job and stable Run Git HEAD, then stops the daemon and deletes all
temporary assets. No production Relay Jobs, database or Project is modified.

## Outstanding parity gates

T023–T025 remain open: interactive `review-stages.json`, Vlog private
`--no-review`, unbound discovery source recovery, bounded project-owned JS
preflight adapters, foreground attached event streaming, and full CLI variant
parity. These are not accepted as migrated and must fail closed.

The **currently installed Relay bundle** omits the native
`owned-process-supervisor` executable. The isolated E2E supplies its already
built copy only in a disposable binary directory. Relay's own release must
include that supervisor before clean-Mac deployment is certified.
