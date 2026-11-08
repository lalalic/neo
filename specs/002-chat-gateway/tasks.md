# Tasks: Chat Gateway

**Input**: Design documents in `specs/002-chat-gateway/`
**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`
**Resolved**: research O1 notification invocation through the local Neo.app MCP `setup` tool; see `research.md`.

## Phase 1: Setup

- [x] T001 Create the Service Skill skeleton `skills/chat-gateway/SKILL.md` declaring `requires.skills: [daemon-service-manage]`, service ownership and bootstrap, modeled on `skills/events-bus/SKILL.md`.
- [x] T002 Add `skills/chat-gateway/package.json` with `bin: chat-gateway`, Node 22+, `@nats-io/transport-node` dependency and MCP-over-HTTP stateless JSON-RPC implementation.
- [x] T003 [P] Add `core/config.mjs`: resolve NATS URL/prefix (env, Events Bus `runtime.json`, defaults), dashboard URL, state directory, intervals.

## Phase 2: Foundational

- [x] T004 Implement `core/ledger.mjs`: atomic JSONL append, key lookup, pending/delivered/baseline states, bounded pruning that keeps pending records.
- [x] T005 [P] Test ledger durability, dedupe by key, restart recovery, and pruning in `test/ledger.test.mjs`.
- [x] T006 Implement the injected-adapter seams (NATS, dashboard, notifier, clock) used by all tests in `test/helpers.mjs`.

## Phase 3: User Story 1 - Job completion on the phone (P1)

**Goal**: Every terminal job state is delivered once.

**Independent Test**: Stub adapters; publish synthetic events; replay; restart.

- [x] T007 [US1] Test event filtering (terminal versus non-terminal, malformed, unknown fields) in `test/subscriber.test.mjs`.
- [x] T008 [US1] Implement `core/subscriber.mjs`: subscribe to `neo.events.job.*.job.runtime_status.changed`, filter `data.to`, write pending ledger entries, reconnect with backoff.
- [x] T009 [US1] Test baseline-on-first-start (nine historical COMPLETED jobs, zero notifications) and missed-event reconciliation in `test/reconcile.test.mjs`.
- [x] T010 [US1] Implement `core/reconcile.mjs`: dashboard `/api/jobs` diff against the snapshot; run at start, reconnect and every 5 minutes; keep only id, title, state, repository, updatedAt.
- [x] T011 [US1] Test retry/backoff, pending-until-acknowledged, burst coalescing (more than 5 in 30 seconds) in `test/notify.test.mjs`.
- [x] T012 [US1] Implement notification text builder (title, state, job id, repository only) and retry scheduler in `core/notify.mjs`.
- [x] T013 [US1] Test that no objective, path or secret field reaches notification text in `test/notify-privacy.test.mjs`.
- [x] T014 [US1] Implement the Neo events notification client in `core/notify.mjs` using the path resolved in research O1; map `CANCELLED` per O2.

## Phase 4: User Story 2 - Orchestrator reports (P1)

**Goal**: The thread reports at its own discretion; urgency is its call.

**Independent Test**: Call `chat_report` over loopback with a stub notifier.

- [x] T015 [US2] Test `chat_report` validation, persistence, `info` versus `attention`, and 60-second coalescing in `test/report.test.mjs`.
- [x] T016 [US2] Implement `mcp/server.mjs` loopback HTTP MCP with `chat_report`; persist reports in the ledger; never require or track per-turn reports.
- [x] T017 [US2] Test that silence produces no report or notification (no liveness tracking) in `test/report.test.mjs`.

## Phase 5: User Story 3 - Execution environment (P2)

**Goal**: The orchestrator knows office versus home.

**Independent Test**: Fake clock and override file.

- [x] T018 [US3] Test resolution order, weekday window boundaries (08:00 and 18:00), override set/clear in `test/env.test.mjs`.
- [x] T019 [US3] Implement `core/env.mjs` (override, observed stub, heuristic) and add `chat_env` to `mcp/server.mjs`.

## Phase 6: CLI, lifecycle and documentation

- [x] T020 Implement `cli/chat-gateway.mjs`: `serve [--dry-run]`, `health`, `status`, `env get|set`, `setup` (dry-run default; `--apply` runs `serviceman define` and `neo mcp add`).
- [x] T021 Test CLI parsing, dry-run zero-write behavior, and `setup` argv in `test/cli.test.mjs`.
- [x] T022 [P] Write `docs/chat-gateway-orchestrator.md` with the Project instruction text and the report guidance from `quickstart.md`.
- [x] T023 Verify packaging: private immutable tarball launched through `npx --package` resolves the CLI without a source checkout; registry publication and `@latest` require separate authorization.
- [x] T024 Run `npm test`, then on the host `chat-gateway setup --apply`, `neo service status chat-gateway/server` and `chat-gateway health`; confirm one real completion notification path end to end (NATS to Neo.app forward acknowledgement; device-level presentation not independently confirmed).

## Dependencies

- T001, T002 before everything else; T004 before Phase 3 and 4; T006 before all tests.
- Research O1 was resolved with the Neo.app `setup` MCP tool and tested against the live loopback endpoint.
- US1, US2, US3 are independently shippable after Phase 2; recommended order US1, US2, US3.
