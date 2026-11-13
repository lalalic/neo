---
name: chat-gateway
description: Route Relay terminal events to the Orchestrator for verified mobile reports and provide an authenticated Neo Mobile Chat feed.
requires:
  skills:
    - daemon-service-manage
---

# Chat Gateway

## Service owner and behavior

One service, chat-gateway/server, monitors Relay terminal events and reconciles with the dashboard. It silently baselines pre-existing jobs, then submits deduplicated, durable new-turn requests to the bound Orchestrator thread for every new terminal transition. The Orchestrator checks Relay Job/JEL evidence and sends an owner-facing chat_report; only its attention reports produce phone pushes. The Chat tab contains reports and owner submissions, never raw Job events; Jobs tab retains lifecycle history. Failed turn submissions retry with a stable idempotency key. The gateway never reads raw ChatGPT streams or job prompts. No Relay, Events Bus, dashboard, or Neo.app internals are modified.

The loopback MCP service at http://127.0.0.1:8791/mcp is federated into authenticated Neo.app as tool mcp.chat-gateway, accepting these command subcommands:

- chat_report: text (1..2000 characters), optional level info/attention, jobId and needs. Info persists silently; attention may push. Do not require per-turn reports.
- chat_env: office/home mode and source, plus phone connection observation if available.
- chat_feed: optional limit 1..100, default 50. Returns owner-safe report/owner history with no raw Job events, prompts or paths.
- chat_jobs: optional limit 1..100, default 100. Returns active and recent Relay jobs from the dashboard, containing only ID, title, status, repository, creation and update timestamp; supplies the separate Neo Mobile Jobs tab.
- chat_job_activity: exact local repository name (e.g. vlog) and jobId. Returns repository-scoped, owner-safe, ordered durable lifecycle events from the public Events Bus history; no raw payloads or private metadata.
- chat_job_cancel: exact local repository name (e.g. vlog) and jobId. Cancels an eligible Relay Job through Relay's real cancellation Graph and returns only after an authoritative CANCELLED readback. No PR number is required.
- chat_head: whether a current orchestrator ChatGPT head thread is bound.
- chat_bind: threadId (validated) to bind or update the orchestrator head thread on creation/handoff.
- chat_send: owner text and stable requestId. Forwards to bound head using Neo.app ChatGPT durable async queue, stores the result. Submitted means queue acceptance, NOT an assistant reply. Duplicate requestId never submits again.

## Lifecycle: source direct, like Vlog Watcher

This is a tracked-source service. The canonical repository's skills/chat-gateway/neo-project handles setup, start, restart, stop, status, health and uninstall. The PM2 process named chat-gateway/server must run that repository's cli/chat-gateway.mjs and imported core modules directly. Do NOT use npm pack, a tarball, npx --package, or a copied .service runtime. npm ci is only for installing third-party NATS dependencies.

During HOTFIX use CLI setup without --apply (read-only) and serve --dry-run for isolated tests. After Neox simulator and REAL iPhone send/receive E2E are complete, merge the hotfix worktrees and run setup --apply from the canonical main checkout. This migrates the old packaged PM2 process, verifies health and registers the MCP. Never point production PM2 at a disposable worktree, never deploy early, and never use Relay Jobs to run the gateway.

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


## Required mobile remote exposure gate

Neo.app Remote tab explicitly controls which MCP providers can be used by the phone through the existing authenticated gateway. Installing or federating a provider locally does not expose it remotely. For final release explicitly enable chat-gateway under Remote providers and Apply, without saving any unrelated pending host/tunnel draft. Confirm deployment show includes chat-gateway in remote_providers. Do not enable all providers or bypass the NeoY gateway. For staging test enable only chat-gateway-staging, then remove it after test.
