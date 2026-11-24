# Plan

1. Inventory Node contract and tests; establish Rust service crate and data types/store with atomic private files, exact identity, validated input and catalog.
2. Port native reply event subscriber, response engine, WebHelm action transport and HTTP/SSE layer. Add executable and parity tests.
3. Port Orchestrator state machine, attachment store, handoff verifier, notifications and Relay event monitor. Exercise restart and reconciliation on isolated fixtures.
4. Port any required MCP/legacy proxy surfaces, review ownership and remove Node implementation only after all contract tests are represented and passing.
5. Candidate real Codex MVP1/2/3 using isolated state; preserve evidence. Only then merge/push and perform the documented live release gate. Roll back on failed live gate.
