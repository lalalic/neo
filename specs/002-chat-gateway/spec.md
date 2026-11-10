# Feature Specification: Chat Gateway (Neo Mobile Chat Tab, Phase 1)

**Feature Branch**: `002-chat-gateway`
**Created**: 2026-11-08
**Status**: Backend Phase 1 deployed previously; mobile extension IN PROGRESS in restored hotfix worktrees; no new merge/live until phone E2E
**Input**: Owner request for a Neo mobile entry point (the future Chat tab) so the owner does not need to visit ChatGPT, the Agents Relay dashboard, or CLIs to receive information and hand off work. Phase 1 is limited to job completion state plus orchestrator-initiated reports.

## Background

The long-term feature is one logical orchestrator chat on Neo mobile, backed by a ChatGPT Project whose threads relay to each other (a thread decides when to start its successor, because of thread length and latency limits). Tasks run as Agents Relay jobs; the orchestrator thread calls the Relay CLI and Neo MCP directly. Neo does not intercept the ChatGPT conversation or keep its raw message stream: the orchestrator works in **report mode** and tells the owner what matters, when it judges it necessary.

This spec covers only Phase 1, delivered as a **Neo Service Skill** (`chat-gateway`) that runs as a PM2 service on the Mac and federates one MCP server into Neo.app. No existing module is changed: Relay, Events Bus, the dashboard, Neo MCP and ChatGPT are only consumed through their existing interfaces.

## User Scenarios & Testing

### User Story 1 - Job completion reaches my phone (Priority: P1)

As the owner, I get a phone notification when any Relay job reaches a terminal state, so I do not have to watch the dashboard.

**Why this priority**: It is the smallest end-to-end slice of the mobile entry point and needs no thread involvement.

**Independent Test**: Run the service with stub NATS, stub dashboard and a stub notifier; publish synthetic `job.runtime_status.changed` events and verify notifications, dedupe and recovery.

**Acceptance Scenarios**:

1. **Given** a running service, **When** Relay publishes `job.runtime_status.changed` with `data.to` = `COMPLETED` for job J, **Then** exactly one notification for J is delivered, containing the job title and terminal state.
2. **Given** `data.to` = `CANCELLED`, **When** the event arrives, **Then** one notification marked as cancelled is delivered.
3. **Given** `data.to` is any non-terminal status (RUNNING, QUEUED, BLOCKED, ...), **When** the event arrives, **Then** nothing is delivered.
4. **Given** the same terminal state is seen twice (event, then reconciliation), **When** both are processed, **Then** only one notification is delivered.
5. **Given** a first start with an empty ledger and nine historical COMPLETED jobs, **When** the service starts, **Then** it records them as baseline and delivers zero notifications.
6. **Given** a job completed while Relay was restarting and no event was published, **When** the next reconciliation runs, **Then** its terminal state is detected and delivered once.

### User Story 2 - The orchestrator reports to me when it decides to (Priority: P1)

As the owner, I receive messages from the orchestrator thread only when it judges they are worth my attention, and it can mark how urgent they are.

**Why this priority**: It is the reporting channel of the orchestrator design and does not depend on any thread-delivery plumbing.

**Independent Test**: Call the MCP tool against the service with a stub notifier; verify persistence, push policy and throttling.

**Acceptance Scenarios**:

1. **Given** a thread calls `chat_report` with `level: "attention"`, **When** the call succeeds, **Then** the report is persisted and a notification is delivered.
2. **Given** `level: "info"` (the default), **When** the call succeeds, **Then** the report is persisted and no notification is delivered.
3. **Given** several `attention` reports within the throttle window, **When** they arrive, **Then** they are coalesced into one notification that states the count, and every report is still persisted.
4. **Given** invalid input (empty text, oversized text, unknown level), **When** the tool is called, **Then** it returns a validation error and persists nothing.
5. **Given** a thread never calls the tool, **When** time passes, **Then** the system does nothing and shows no "no response" state: silence is valid.

### User Story 3 - The orchestrator knows my execution environment (Priority: P2)

As the owner, I want the orchestrator to know whether I am in the office or at home, so its reports ask for help in a way that fits (for example, "run this on the work node" versus a phone connected over Wi-Fi or USB).

**Why this priority**: It shapes report content but nothing else depends on it.

**Independent Test**: Call `chat_env` with a fake clock and fake override file.

**Acceptance Scenarios**:

1. **Given** no override and a weekday between 08:00 and 18:00 local time, **When** `chat_env` is called, **Then** it returns `mode: "office"` with `source: "heuristic"`.
2. **Given** any other time, **When** `chat_env` is called, **Then** it returns `mode: "home"` with `source: "heuristic"`.
3. **Given** the owner ran `chat-gateway env set home`, **When** `chat_env` is called, **Then** it returns `mode: "home"`, `source: "override"` and the time it was set, until `chat-gateway env set auto`.
4. **Given** a thread reads the result, **When** it composes an `attention` report, **Then** it can set `needs` to `work_node` or `phone` accordingly (the tool only carries the field; wording is the thread's decision).

## Edge Cases

- NATS unavailable at start or lost later: keep retrying with backoff; reconciliation still runs; `health` reports degraded.
- Dashboard unavailable: event-driven delivery continues; reconciliation is skipped and reported degraded; it resumes without notification loss.
- Burst of terminal events (more than 5 within 30 seconds): deliver one summary notification listing the count, while the ledger keeps one entry per job.
- Notification delivery fails: the ledger entry stays pending and is retried with exponential backoff; it is never marked delivered without a delivery acknowledgement.
- Malformed or oversized events: ignored with a bounded diagnostic; the subscription continues.
- Job title missing: fall back to the job id.
- Service restart during delivery: pending entries are redelivered; idempotency key prevents duplicates when the notifier honors it.
- Clock changes or time zone differences affect only the `heuristic` environment source.

## Requirements

### Functional Requirements

- **FR-001**: The service MUST subscribe over NATS to `relay.events.job.*.job.runtime_status.changed`, resolving the NATS URL and subject prefix the same way as Agents Relay (`EVENTS_BUS_NATS_URL`, the Events Bus `runtime.json`, then `nats://127.0.0.1:4222` / `relay.events.job`), and act only on events whose `data.to` is `COMPLETED` or `CANCELLED`.
- **FR-002**: Every terminal state MUST be keyed by `job:<jobId>:<to>:<updatedAt>` and recorded in a durable ledger before delivery; a key MUST be delivered at most once successfully.
- **FR-003**: On first start with an empty ledger, the service MUST read the current jobs from the dashboard API, record existing terminal jobs as baseline, and deliver no notifications for them.
- **FR-004**: The service MUST reconcile against the dashboard job list at start, after NATS reconnect, and periodically (default every 5 minutes), and deliver newly observed terminal states that were not delivered through events.
- **FR-005**: Job notifications MUST use the existing Neo events notification path with kind `completed`, a title containing the job title and terminal state, and a body containing only the job id and repository. Objectives, prompts, paths and credentials MUST NOT be included.
- **FR-006**: Failed deliveries MUST be retried with exponential backoff (cap 1 hour) and remain pending until acknowledged.
- **FR-007**: The service MUST expose an MCP server named `chat-gateway` on loopback with tool `chat_report` accepting `text` (1 to 2000 characters), `level` (`info` or `attention`, default `info`), optional `jobId`, and optional `needs` (`work_node`, `phone` or `none`).
- **FR-008**: `chat_report` MUST persist every valid report; only `attention` reports trigger a notification; `attention` notifications within a 60-second window MUST be coalesced.
- **FR-009**: Reporting MUST be optional for threads. The service MUST NOT require a report per turn, track thread liveness, or emit a "no response" state.
- **FR-010**: The MCP server MUST expose tool `chat_env` returning `mode` (`office` or `home`), `source` (`override`, `observed` or `heuristic`), `since`, and a `phone` object whose `channel` is `unknown` until an observation signal is implemented.
- **FR-011**: Environment resolution order MUST be override, then observed (when available), then heuristic (weekday 08:00 to 18:00 local time is `office`).
- **FR-012**: The package MUST provide a `chat-gateway` CLI with `setup`, `serve`, `health`, `status`, and `env get|set <office|home|auto>`. `setup` MUST declare exactly the service `chat-gateway/server` through `serviceman define` and register the MCP with Neo federation; mutating commands MUST be dry-run unless `--apply` is given.
- **FR-013**: The service MUST bind only to loopback, keep state under `~/.local/state/neo/chat-gateway/`, and keep secrets and tokens out of logs and output.
- **FR-014**: The feature MUST NOT modify or depend on private internals of Relay, Events Bus, the dashboard, Neo MCP or ChatGPT; it MAY use only their documented CLIs, HTTP APIs and NATS subjects.
- **FR-015**: `chat-gateway health` MUST report NATS connectivity, dashboard reachability, notification path status, last reconciliation time, and pending ledger entries.

## Key Entities

- **Terminal Job Record**: One job reaching `COMPLETED` or `CANCELLED`, with idempotency key, delivery status and acknowledgement id.
- **Chat Report**: A message from the orchestrator thread with level, optional job reference and optional `needs`; the future Chat tab feed.
- **Environment State**: Current mode, its source and start time, plus the optional owner override.
- **Job Snapshot**: Last observed job state per job id, used for baseline and reconciliation.

## Success Criteria

### Measurable Outcomes

- **SC-001**: A terminal event produces exactly one delivered notification within 10 seconds when the notifier is healthy.
- **SC-002**: Replaying the same event or reconciling it afterwards produces zero additional notifications.
- **SC-003**: First start against existing historical data produces zero notifications.
- **SC-004**: A terminal state missed by NATS is delivered after the next reconciliation (at most the configured interval).
- **SC-005**: `info` reports never notify; N `attention` reports within one window produce one notification.
- **SC-006**: Isolated tests cover event filtering, dedupe, baseline, reconciliation, retry, throttling, environment resolution and input validation without touching production services.

## Assumptions

- Relay keeps publishing `job.runtime_status.changed` with `data.to` derived from job state, and publishes after daemon start only when a status change is observed (the first observation of a job is a silent baseline).
- Relay does not currently notify the phone for job completion (its notifier covers escalations only), so no duplicate push is expected.
- The Neo events policy has `completed` enabled, so `completed` notifications are forwarded to the paired mobile runtime.
- The owner's usual office hours are weekdays 08:00 to 18:00; this is a fallback only.
- Work node and phone connection details are not yet observable; they are reported as unknown.

## Out of Scope (Future Phases)

- The thread chain: successor-thread creation, checkpoints, handoff packets and head tracking.
- Linking jobs to the orchestrator chat and delivering merged terminal events to the head thread for an overall report.
- Human-input events, approvals and interactive requests: these stay with the existing escalation and interactive-request flows by owner decision.


## Mobile completion gate (supersedes earlier Phase 1 completion claim)

The initial 24 tasks covered only the backend, and the packaged runtime was deployed prematurely. New acceptance scope is a real Neox Chat tab with authenticated history of job and orchestrator reports; a phone composer that sends idempotently through the existing Neo.app ChatGPT new-turn queue to a bound head thread; explicit orchestrator replies via chat_report; and direct-source PM2 lifecycle analogous to Vlog Watcher. The thread binding may be changed at a handoff. Automatic creation of successor threads is still out of scope.

The full feature MUST NOT be merged, deployed or cleaned up until Node tests, iOS simulator tests, real iPhone authenticated send/receive, and on-device notification presentation are verified. A ChatGPT queue receipt is not an actual assistant reply; notification forwarding confirmation is not iPhone presentation.

### Presentation acceptance: invisible recovery

When there are no messages, the Chat tab displays a blank timeline, not a "no messages" placeholder. No connection, authentication, Project bootstrap, missing-head, network failure, or retry status is displayed. There is no top title or top button; the owner always has the composer. Messages are persisted to a protected iPhone outbox before clearing the composer, and automatically sent/retried with their stable identities. Backend readiness and failures remain in service health/diagnostics; UI silently retries while preserving content. The only enabled/disabled send-button gate is valid nonempty message text of bounded size.
