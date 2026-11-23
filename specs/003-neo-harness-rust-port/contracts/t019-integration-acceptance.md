# T019: Native Rust Harness integration acceptance — 2026-11-23

## Verified integration gates

1. Native vs existing Node read-only CLI acceptance: `node scripts/verify-rust-harness-readonly.mjs`, **14/14 passed** on Neo Master. Includes actual workspace, 14 Projects, 51 Skills, 291 Agents, Bootstrap, NeoY MCP Tools, Computer Use Help, 10 managed services, Status, Doctor and two canonical Help outputs. Comparison is structural JSON with stable key ordering; it does not output private bootstrap rules or tool payloads.
2. Live **read-only** NeoY Computer Use `call list_apps`: both Node and Rust CLI reached the same configured local service, exit 0, `isError:false`, one structured returned content item. No GUI action or account write was requested.
3. Real isolated Rust Relay E2E: `node scripts/verify-rust-relay-isolated.mjs /absolute/agents-relay/repo` **passed** using disposable Git repo, scratch SQLite + daemon, private HOME and cloned Relay executable; created one ACTIVE Coordinator Job, resumed the same Job/Task, preserved Run Git HEAD, and attached a foreground process to the existing Job. No production SQLite, Project or Job was modified.
4. Mandatory Relay `job create --preflight=true` contract was synchronized from current `main`. Native new Run creation rejects missing, false, malformed or duplicated attestation **before a Job is created** and never silently asserts review success. Bound Run resume does not require a second attestation. The exact explicit flag is forwarded to authoritative Rust Relay. Native fixture tests **25/25** passed for Project Run lifecycle.
5. Native `neo-rs escalation test` against a real, locally cached Qwen3.5 4B GGUF through `llama-server`: read-only Shell nonce unknown in the prompt was observed via a real tool result; correct nonce was returned as evidence; checks `shell_tool_execution`, `unknown_value_verified`, `no_human_notification_requested` all passed. Server was bound to `127.0.0.1`, no download or cloud network call, private temporary HOME and lock, and model server process group reaped.
6. Real offline small-model result contract: the diagnostic failure on omitted/irregular no-notification reporting was fixed with an explicit `notification:null, reason:null, user_action:null` self-test instruction and conservative optional-field normalization for `attempted:false`. Invalid actual notification delivery claims remain rejected. A strict model result cannot invent successful tools, evidence, or human notification.
7. Clean package/Node-free smoke already covered by four Rust bundle tests with fresh HOME and versioned symlink; native Agent/Skill/Bootstrap core needs no Node/Python in PATH. Current source-only Rust full suite: **184/184 passed**, `cargo fmt --all -- --check` and `cargo clippy --workspace --all-targets --offline -- -D warnings` passed.

## Scope and exclusions

- Tests involving production mutation (GUI clicks, authenticated WebHelm actions, production Relay creation, live video publishing) were intentionally not performed without release approval. Existing native adapter contracts and disposable-tool E2E cover these operations. The real model was exercised through an existing loopback server rather than forcing a second real 64K-context 4B server onto a 16GB host; process-owned server creation/cleanup is verified by separate disposable E2E.
- The original Node packaging test remains known to fail on the already tracked external symlink `skills/iphone-helm`; it reproduces on unchanged `main`. The Rust distribution's explicit handling of nonregular assets has passed its independent stage tests. This known Node fixture issue is **not** treated as Rust acceptance failure or quietly attributed to this migration.
- `T020` remains explicitly **unapproved and unexecuted**: installed `neo` launcher, real production Neo.app services, and Node core removal remain unchanged. Do not merge/deploy or remove Node source without explicit user approval of release.

## Reproduction

```sh
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --offline -- -D warnings
cargo test --workspace --offline
node scripts/verify-rust-harness-readonly.mjs
node scripts/verify-rust-relay-isolated.mjs /absolute/agents-relay/repo
```

The real offline self-test is performed only when a previously cached local GGUF and a supported llama-server are available. Run it in an isolated HOME and lock with a loopback `NEO_ESCALATION_ENGINE=external` URL, followed by explicit cleanup. Never persist the random nonce or full model transcript.
