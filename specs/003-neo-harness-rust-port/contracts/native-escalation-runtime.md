# Native Rust Escalation execution and owned local model (T017 sub-slice)

`neo-rs escalation --handoff-file PATH [--cwd DIR] [--on-needs-user-file PATH]
[--correlation-id OPAQUE_ID]` now connects the previously verified native
components into one synchronous process-owned recovery flow.

## Durable execution lifecycle

- Read the complete original Handoff and notification policy. Create the
  private Challenge and immutable `started` record **before** evaluating the
  local model configuration. Preflight failures still leave an identifiable
  failed Attempt rather than an empty or misleading success record.
- Checkpoint the `preflight`, `resource_lock`, `model_startup` (owned models),
  `agent_execution`, `result_parsing` and terminal stages. Use the native
  guardian's **single global kernel flock**; another request waits or
  returns a recorded lock failure. There is no second Relay scheduler,
  artificial lease database, model service install or hidden task replay.
- `NEO_ESCALATION_ENGINE=external` requires an explicitly configured
  `http://127.0.0.1:PORT/v1` inference endpoint. The native client refuses
  remote URLs and redirects. `llama`/`mlx` instead start exactly one owned
  model process, bound to a randomly selected loopback port. Health checks
  are bounded, and stdout/stderr stay in a private disposable model directory.
- The model starts in a separate OS process group; the guardian registers
  **the whole owned group**, not just the leader PID. If the caller crashes,
  its pipe closes, the guardian terminates its owned group before releasing
  the resource. Normal terminal paths close the model, wait for process exit,
  remove private diagnostics, then release the flock.
- The stateless model loop executes named tools through the existing native
  Shell/WebHelm/Computer Use adapter and demands successful observed tool
  evidence before accepting `resolved`. The caller's Agent rules and
  installed recovery playbook remain available to the local model. The
  external model server and tools are never called during CLI argument
  validation or invalid model configuration handling.
- Results are normalized and redacted before **any** Case or terminal
  Challenge outcome is written. The optional synthesized Experience record
  includes only sanitized classification, verified steps, tool names and
  counts. Failed model execution remains `failed` with a categorized stage,
  while duplicate tasks are never silently retried by the recorder.
- The owner-controlled variable `NEO_ESCALATION_APPLE_LOGIN_AUTHORIZED=true`
  is required to enable Apple sign-in field filling; this is **disabled by
  default**. It still cannot submit a login or bypass real human consent.
- The native `escalation --help` text is byte-for-byte identical to the Node
  reference; the diagnostic documentation is compiled into the binary.

## Acceptance evidence (2026-11-23)

- Five isolated orchestration tests passed: successful model/tool exchange
  and redacted Case + Finished evidence, erroneous model success rejection,
  malformed configuration, competing flock slot, and stable Challenge
  identity on an explicit retry.
- Three owned-server tests passed: fake llama startup/health and shutdown,
  immediate startup failure and timeout cleanup. The native guardian also
  passes six private tests, including full model **process-group** cleanup
  after the caller-pipe closes and lock reacquisition.
- Six CLI acceptance tests passed, invoking the actual Rust CLI as a new
  process with a **disposable home and private ledger**. It exchanged JSON
  with a real temporary local TCP model, executed exactly one synthetic
  Shell command, verified Exit 0/Exit 2 behavior, recorded failed preflight,
  matched Node CLI Help bytes and exercised an owned temporary Node fixture
  acting as a llama-server (not a real inference model).
- **All Rust integration tests: 156/156 passing.** Strict Clippy and
  `cargo fmt --check` pass. Original Node local Escalation, stateless agent,
  guardian, Challenge and Experience reference tests: **41/41 passing**.
- No production model loaded, public cloud endpoint contacted, Apple account
  action performed, production record changed or installed launcher replaced.

## Open acceptance gaps

- The old interactive `neo escalation learn` and live-model self-test (`neo
  escalation test`) remain **explicitly unsupported** in Rust, not silently
  passed through Node. Post-run optional model-generated Experience capture
  and taught-lesson retrieval still need parity and live-device acceptance.
- `project setup-agent` and the final Neo.app end-to-end/release matrix remain
  separately tracked in T017/T019. Full production cutover requires the
  explicit T020 approval gate. This is an implemented **native recovery
  execution path**, not a claim that every CLI surface is migrated.
