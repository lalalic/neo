# Native Release CLI reliability black-box

```sh
cargo build --release --offline -p neo-harness-cli --bin neo-rs
node scripts/verify-rust-relay-isolated.mjs /absolute/agents-relay --reliability
node scripts/verify-rust-harness-reliability-blackbox.mjs
NEO_BLACKBOX_LOCAL_GGUF=/absolute/cached-model.gguf node scripts/verify-rust-harness-reliability-blackbox.mjs
```

The actual optimized CLI runs against installed Rust Relay binaries in a
private workspace, SQLite database and daemon. Six concurrent submissions
of the same canonical Run must produce identical Job/Task identity and a
single durable Job. Foreground SIGINT and SIGTERM are delivered to the
owned foreground process group, not the daemon: both detach, the group
exits, the binding bytes and Run Git HEAD remain unchanged, and re-entry
resolves the existing ACTIVE Job. This does not assert completion of a
model Worker or managed Final Review.

The separate fault-injection driver uses a disposable HOME and loopback
synthetic MCP server. HTTP 503, malformed JSON, mismatched JSON-RPC ID,
explicit RPC error, redirect, disconnected response and stopped listener
must fail closed. A dropped mutating response must not automatically replay
the tool call. A new explicitly initiated request works after recovery.
This verifies transport behavior, not a real AskQuestions UI action.

When supplied an existing cached local GGUF path, the driver launches real
llama-server via the native CLI. A competing caller with a one-second
inference-lock wait must fail without taking ownership of the first model.
Killing only the caller with SIGKILL must cause its guardian to release the
owned model process group and exit. A fresh invocation acquires the same
lock and proves the unknown-value read using actual inference. The temporary
HOME and TMPDIR are removed; no model download or live Relay state mutation.
This test verifies process cleanup, not production ledger crash recovery.

Additional manually executed actual Release evidence: cached Qwen3.5-4B
Q4_K_M self-test passed (13.004s reported, owned process released). A real
handoff read an unknown multiword fixture sentence, returned resolved with
one actual shell tool call, persisted one terminal Challenge and one
Experience, and released the model. An earlier single-token evidence check
was redacted as designed; the privacy rule was not relaxed. Computer Use
mutation remains outstanding: the actual macOS console was still locked
according to both CGSessionCopyCurrentDictionary and IORegistry, and the
Node/Rust CLI snapshots both lacked the fixture controls. The owned GUI
fixture was removed without sending input.

Remaining: managed Final Review, actual GUI mutation, interactive Learn,
provider Docker/TLS/WSS and production launcher activation. No production
launcher cutover or paid operation is part of this suite.

Regression note: one terminal-DAG run returned a generic Relay command failure
before completion; an independent rerun passed with one Script Worker attempt,
two durable events and a COMPLETED Job. Root cause has not been established;
this intermittent test failure remains a follow-up, not a diagnosed fix.
