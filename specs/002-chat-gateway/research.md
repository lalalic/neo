# Research: Chat Gateway

Findings were read from the installed `agents-relay`, the Events Bus Skill, the Neo CLI help, and the running host on 2026-11-08.

## Verified findings

- **Event transport.** Relay publishes to NATS at `127.0.0.1:4222` on `relay.events.job.<jobId>.<type>`. The envelope has `version`, `event_id`, `job_id`, `task_id`, `parent_task_id`, `type`, `status`, `timestamp`, `visibility`, `level`, `message`, `data`, `source`. NATS runs as the PM2 service `events-bus/nats`.
- **Job-level status event.** `job.runtime_status.changed` carries `data: { from, to, repository, jobState, updatedAt }`. `to` comes from `deriveJobRuntimeStatus`, which returns `CANCELLED` or `COMPLETED` directly from job state. Job states are `DRAFT`, `ACTIVE`, `COMPLETED`, `CANCELLED`.
- **Event gaps.** The change detector is process-local; a job's first observation after daemon start is a silent baseline. Core NATS has no replay, so a restart can hide a transition.
- **History API.** Events Bus serves `http://127.0.0.1:4223/events?job=<id>&order=asc&after=<cursor>`; it needs a job id, so it is not a global catch-up source.
- **Dashboard API.** `http://127.0.0.1:8787/api/jobs` returns the full job list (about 1 MB). Other routes include `/api/status`, `/api/runtime-summary`, `/api/events`.
- **Runtime config.** NATS URL and prefix resolve from `EVENTS_BUS_NATS_URL`, `EVENTS_BUS_SUBJECT_PREFIX`, `~/Library/Application Support/EventsBus/runtime.json`, then defaults.
- **Long-lived jobs.** Several jobs are autonomous and ACTIVE indefinitely; they will simply never produce a completion.
- **Service Skill contract.** Skills owning persistent PM2 services declare `requires.skills: [daemon-service-manage]`, name services `<skill>/<service>`, and define them with `serviceman define ... --apply`. Neo.app discovers declaring Skills. `neo service list` shows PM2-managed services.
- **MCP federation.** `mcp add <name> <http(s)-url | stdio:///absolute/executable?arg=...>`; enabled tools appear as `mcp.<server>.<tool>`; stdio MCPs are supervised by federation.
- **Notification policy.** Neo events policy has `blocked`, `failure`, `completed`, all enabled. `events notify <kind> "<title>" <body...>` forwards important events to the paired NeoX runtime.
- **Relay's own notifier** (`AGENTS_RELAY_ESCALATION_NOTIFY_URL`) handles escalations only; no existing job completion push was found.
- **Spec layout.** `specs/001-neo-project-run/` uses `spec.md`, `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `tasks.md`, `checklists/requirements.md`; this spec follows it.
- **Distribution rule.** Root `AGENTS.md`: externally shipped npm services managed by Neo.app use published `@latest` launchers; project-owned local services may run source scripts via `neo-project` and PM2 instead.

## Decisions

- **D1** Terminal set is `COMPLETED` and `CANCELLED`; `FAILED` (for example planner failure) is not terminal and is excluded in Phase 1.
- **D2** Push all jobs, not only jobs a thread created (owner decision); job-to-chat association is deferred.
- **D3** Reuse the existing Neo events notification instead of adding a push channel.
- **D4** Reporting is optional and thread-initiated (owner decision); no liveness or "no response" state.
- **D5** Environment source order: override, observed, heuristic; the owner's weekday 08:00 to 18:00 pattern is a fallback only.
- **D6** Human-input events, approvals and interactive requests are out of scope (owner decision).

## Resolved decisions and open items

- **O1 RESOLVED (2026-11-08)** Neo.app MCP loopback endpoint exposes the `setup` tool. A JSON-RPC `tools/call` with `arguments.command = "events notify completed \"Title\" body"` is accepted; `events status` returned enabled policies. A private NATS test-subject terminal event triggered one successful Neo forwarding acknowledgement.
- **O2 RESOLVED** `CANCELLED` uses the existing `completed` notification kind with an explicit `cancelled` title. Neo events exposes no cancelled kind.
- **O3 RESOLVED for Phase 1** Use a private packaged npm tarball launched with `npx --package <absolute tarball> chat-gateway serve`. No registry publication or checkout execution. If later authorized for npm publication, switch the launcher to published `@latest` and validate the upgrade path.
- **O4** Observing phone connection type (phone harness versus Wi-Fi or USB). Not verified; Phase 1 reports `unknown`.
- **O5** Whether `/api/runtime-summary` is a lighter source for reconciliation than `/api/jobs`.
- **O6** How a Neo "feature" is declared (`feature install|complete` exists, `feature list` is empty). It could replace manual `neo mcp add`; not required for Phase 1.

## Phase 1 live verification (2026-11-08)

- Packaged build `chat-gateway-skill-0.1.2.tgz` runs via `npx --package` independently of the Git checkout. Production PM2 service `chat-gateway/server` is online, status `ok`; NATS and dashboard are reachable, and Neo event policy enables completed notifications. The first start baselined 15 historical terminal jobs without sending a notification.
- Real isolated NATS synthetic completion reached Neo.app's `events notify completed` through the notifier, yielding one forwarding acknowledgement. The production `mcp.chat-gateway` federated proxy returns `chat_env`, persists an `info` report silently and forwards an `attention` report once. Its ledger shows no pending reports afterward.
- Node tests: 25 passed, 0 failed; npm dependency audit: 0 vulnerabilities. PM2 process list was saved. An on-device iPhone application responded to `agent.pilot` snapshot, but iOS notification-centre presentation of this push was **not** independently observed; Neo forwarding confirmation is not proof of visible device display.
- The current Neo MCP federation has a proxy tool `mcp.chat-gateway` whose `command` subcommands are `chat_env` and `chat_report`, not two separate top-level tools.
