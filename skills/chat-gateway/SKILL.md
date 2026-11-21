---
name: chat-gateway
description: Maintain legacy Relay live-watch and mobile job-controls MCP compatibility; Neo Mobile Orchestrator Chat now uses the authenticated Models REST/SSE gateway.
requires:
  skills:
    - daemon-service-manage
---

# Chat Gateway

## Current owner boundary (2026-11-21)

**Do not use this MCP Skill as the primary Neo Mobile Orchestrator Chat
transport.** Neo Mobile Chat now uses the Models-owned, authenticated
`/orchestrator-chat/*` REST/SSE endpoint; its reply producer uses the existing
Events Bus `publish` channel with a complete envelope and terminal
`reply.completed`. The phone owns local chat history and outbox. Routine
completed chat does **not** produce APNs. The Models service verifies handoffs
and owns the persistent Codex/ChatGPT Project head mapping.

See [current Orchestrator contract](../../docs/chat-gateway-orchestrator.md)
and [Models release requirements](../../services/models/MVP_GATE.md).
The commands listed below still describe the **legacy compatibility service**,
Relay live-watch behavior, and older mobile MCP Jobs clients. They do not
replace the current Chat REST routes. Do not re-enable or recreate a retired
chat-report tool to make a phone reply appear.

## Legacy service owner and behavior

One service, chat-gateway/server, monitors Relay terminal events and reconciles with the dashboard. It silently baselines pre-existing jobs, then submits deduplicated, durable new-turn requests to the bound Orchestrator thread for every new terminal transition. The legacy watch/report path asks the Orchestrator to check Relay Job/JEL evidence and produce an owner-safe report; the Models Orchestrator path instead consumes Events Bus reply envelopes. Only attention/action/failure conditions warrant phone pushes. The current Chat tab gets its replies from Models REST/SSE, never raw Job events; the Jobs tab retains sanitized Relay lifecycle history. Failed turn submissions retry with a stable idempotency key. The gateway never reads raw ChatGPT streams or job prompts. This section documents the legacy service boundary; it does not describe the new Models-owned Chat endpoint.

The legacy loopback MCP service at http://127.0.0.1:8791/mcp may remain federated into authenticated Neo.app as tool mcp.chat-gateway for compatibility. Its older command contract is:

- chat_report: text (1..2000 characters), optional level info/attention, jobId and needs. Info persists silently; attention may push. In the old MCP-fed Chat flow only, a reply required `chat_report`; current Orchestrator replies must use the Models Events Bus contract.
- chat_env: office/home mode and source, plus phone connection observation if available.
- chat_feed: optional limit 1..100, default 50. Returns owner-safe report/owner history with no raw Job events, prompts or paths.
- chat_jobs: optional limit 1..100 (default 20), offset >= 0 (default 0). Returns stable, active-first pages of Relay jobs (total, nextOffset, hasMore) from the dashboard, containing only ID, title, status, repository, creation and update timestamp; supplies the separate Neo Mobile Jobs tab.
- chat_job_tasks: exact local repository and jobId. Returns only durable Task IDs and Task titles, for Neo Mobile Review list labeling (including already-acknowledged historical reviews); no prompts, objectives, or paths.
- chat_job_activity: exact local repository name (e.g. vlog) and jobId. Returns repository-scoped, owner-safe, ordered durable lifecycle events from the public Events Bus history; no raw payloads or private metadata.
- chat_job_cancel: exact local repository name (e.g. vlog) and jobId. Cancels an eligible Relay Job through Relay's real cancellation Graph and returns only after an authoritative CANCELLED readback. No PR number is required.
- chat_head: whether a current orchestrator ChatGPT head thread is bound.
- chat_bind: threadId, and previousThreadId when changing the head, to update the orchestrator head on creation/handoff. The Gateway verifies the candidate is a loaded conversation in the same bound Project (read-only WebHelm inspection); an unverified or cross-Project ID cannot replace the head.
- chat_send: owner text and stable requestId. Forwards to bound head using Neo.app ChatGPT durable async queue, stores the result. Submitted means queue acceptance, NOT an assistant reply. Duplicate requestId never submits again.
  In this legacy path only, every turn carries a short routing envelope (`source`, `requestId`, bound `projectId`, bound `headThreadId`, `replyVia`) and the actual user text; full Project Instructions are not copied into each turn. A full pending-work handoff is supplied only when the Orchestrator creates a successor thread.

## Lifecycle: source direct, like Vlog Watcher

This is a tracked-source service. The canonical repository's skills/chat-gateway/neo-project handles setup, start, restart, stop, status, health and uninstall. The PM2 process named chat-gateway/server must run that repository's cli/chat-gateway.mjs and imported core modules directly. Do NOT use npm pack, a tarball, npx --package, or a copied .service runtime. npm ci is only for installing third-party NATS dependencies.

During HOTFIX use CLI setup without --apply (read-only) and serve --dry-run for isolated tests. When changing this **legacy** PM2 service, merge and test its source, then run setup --apply from the canonical main checkout. A Models REST/SSE-only change does not require enabling or restarting this MCP service. That setup operation migrates the old packaged PM2 process, verifies health and registers the MCP. Never point production PM2 at a disposable worktree, never deploy early, and never use Relay Jobs to run the gateway.

## Events Bus configuration and cutover

The gateway subscribes to the configured `relay.events.job` namespace via
`EVENTS_BUS_CONFIG`, `EVENTS_BUS_DATA_DIR`, `EVENTS_BUS_NATS_URL`, and
`EVENTS_BUS_SUBJECT_PREFIX`. The previous `NEO_*` event environment aliases
are unsupported. A saved legacy prefix fails closed. This subscriber **must**
be included in the coordinated [Events Bus namespace cutover](../events-bus/references/relay-namespace-cutover.md),
otherwise Neo Mobile Job completion notifications can stop arriving. Do not
restart the live gateway in isolation while Relay and the Events Bus recorder
use a different subject.

## Privacy and diagnostics

Private state is under ~/.local/state/neo/chat-gateway. History only exposes explicit reports, owner messages, and terminal job metadata; no jobs objectives, credentials or file paths. Service binds to loopback, so Neo.app remains the only externally authenticated boundary. All persistent records are private permissions. CLI health reports NATS, dashboard, notification forwarding, reconciliation and pending delivery states. Forwarding acknowledgement is NOT proof an iPhone displayed the push.


## Remote exposure gate for legacy MCP clients only

Current `/orchestrator-chat/*` and `/relay/api/mobile/*` REST paths use the saved authenticated Master route; no `chat-gateway` Remote provider must be enabled for those paths. When an older MCP client explicitly needs compatibility tools, Neo.app Remote tab explicitly controls which MCP providers can be used by the phone through the existing authenticated gateway. Installing or federating a provider locally does not expose it remotely. If releasing a legacy MCP client, explicitly enable chat-gateway under Remote providers and Apply, without saving any unrelated pending host/tunnel draft. Confirm deployment show includes chat-gateway in remote_providers. Do not enable all providers or bypass the NeoY gateway. For staging test enable only chat-gateway-staging, then remove it after test.
