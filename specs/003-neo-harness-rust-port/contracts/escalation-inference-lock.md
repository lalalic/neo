# Rust local inference lock guardian (T017 sub-slice)

The Rust library `escalation_lock` implements an **OS kernel flock** on the
original shared `~/.local/state/neo/escalation/inference.lock`. It also accepts
the original `NEO_ESCALATION_LOCK_DIR` and
`NEO_ESCALATION_LOCK_WAIT_SECONDS=1..14400` settings.

## Process and ownership model

- The caller launches a separate short-lived **native Rust guardian** through
  the same executable's hidden `__escalation-lock-guardian` entrypoint. No
  Python interpreter, Node process, Relay lease, background daemon or
  database/heartbeat is involved.
- The guardian opens a regular current-user-owned lock file using
  `O_NOFOLLOW|O_CLOEXEC`, forces mode 0600, obtains nonblocking exclusive
  `flock(2)` and waits up to the configured timeout. It never deletes the
  shared lock inode. The lock directory must be a real local directory with
  mode 0700.
- While waiting, the guardian checks the parent-tethered stdin pipe for
  disconnection; an orphan queued request exits instead of unexpectedly
  taking the lock after its requestor died.
- After acquisition, the guardian prints `ACQUIRED` once. It accepts
  `PID <owned inference server PID>` registrations only over its inherited
  private IPC. When the parent closes the pipe or is killed, it SIGTERMs
  registered model processes, waits up to six seconds, SIGKILLs remaining
  processes, then releases the lock. `Guard::finish` waits for cleanup.
- Only *positively identified child processes created by the caller* should
  ever be registered. Reusing a broad process name, stored lease ID, or an
  unrelated process PID is forbidden by the owning Escalation runtime.

## Evidence (2026-11-23)

- Five native integration tests passed in private temporary directories:
  exclusive contention/timeout/reacquisition, strict filesystem permissions,
  registered test-model termination on disconnect, guardian cleanup after
  parent-pipe EOF, and **cross-runtime lock compatibility** with the
  canonical Node Escalation lock using the exact same flock inode.
- All Rust integration tests: **100/100** passed, strict Clippy with
  `-D warnings` passed.
- No real model was started or killed, no production lock used, and no
  production inference server modified. Tests registered only synthetic
  `/bin/sleep` child PIDs.
- The complete local agent run path, model server startup and tool-calling
  loop, persisted Challenge/Experience outcomes, secret masking and owner
  notifications remain unported. **T017 is not complete** until all those
  runtime requirements are independently verified.
