# Plan

1. Inventory Node contract and tests; establish Rust service crate and data types/store with atomic private files, exact identity, validated input and catalog.
2. Port native reply event subscriber, response engine, WebHelm action transport and HTTP/SSE layer. Add executable and parity tests.
3. Port Orchestrator state machine, attachment store, handoff verifier, notifications and Relay event monitor. Exercise restart and reconciliation on isolated fixtures.
4. Port any required MCP/legacy proxy surfaces, review ownership and remove Node implementation only after all contract tests are represented and passing.
5. Candidate real Codex MVP1/2/3 using isolated state; preserve evidence. Only then merge/push and perform the documented live release gate. Roll back on failed live gate.

## Checkpoint

- Native catalog, input, durable store, reply reducer, SSE, generic HTTP,
  WebHelm transport and NATS subscriber implemented.
- Native Orchestrator queue, attachments, authenticated API, private v1
  transport, replay and ACK implemented. Isolated HTTP/NATS fixture passes.
- Native read-only handoff verifier and APNs client implemented; live
  browser handoff and device delivery not yet exercised.
- Remaining: Relay terminal/live-watch monitor and existing reporting MCP
  compatibility, broader parity tests, real candidate Codex gate, and
  production cutover/live gate. Native candidate refuses production port
  and state and fails closed when Relay monitoring is explicitly enabled.
- Native gate accepts --native-binary to fingerprint executable, Rust source,
  Cargo manifests and lockfile together with existing WebHelm Action bytes.
  No candidate or live release evidence has been issued for this branch.
