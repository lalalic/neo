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
- Captured Relay calls have a 120-second timeout and 4 MiB stdout/stderr
  limits; foreground Relay inherits terminal stdio and may remain attached
  until the user's terminal interrupts it, without a second scheduler.
- Explicit project-declared `scripts/*.mjs` preflight uses the external Node
  executable only when that project requests it; execution is limited to
  30 seconds and 1 MiB output. Script failure, missing interpreter, unsafe
  path or output overflow abort before any Run creation or Relay submission.
- Core Rust commands never silently invoke Node or Python.

## Verification

`cargo test --workspace --offline` has 57 passing integration tests. Twelve
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

T023 is verified: named DAG `review-stages.json` policies, private Vlog
`--no-review` with approved private source manifest and publication blocking,
and recovery of unbound source presets from staged immutable evidence.

T024 is verified: bounded project-owned JS preflight and stdout/stderr
inheritance for a foreground Rust Relay attachment. The temporary real-daemon
E2E attaches to the same ACTIVE Job and safely terminates the test terminal,
without altering the Job ID/Task ID, introducing a second Job or touching live
SQLite.

T025 is verified: native `project run --help` is byte-identical to the Node
reference via a compiled-in static document; error/flag matrix, unicode title,
Coordinator ID validation, DAG selection lock, prepared URL Runs, Vlog
publisher and six-Stage Growth policy parity are covered. Node reference
suite: **38/39 passing**, with the sole known packaging failure on a tracked
`skills/iphone-helm` symlink. Rust Project Run tests have no failures. The
preexisting Node package staging issue is independent of Run lifecycle and
belongs to Rust distribution T018.

The **currently installed Relay bundle** omits the native
`owned-process-supervisor` executable. The isolated E2E supplies its already
built copy only in a disposable binary directory. Relay's own release must
include that supervisor before clean-Mac deployment is certified.
