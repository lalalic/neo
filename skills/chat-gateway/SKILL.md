---
name: chat-gateway
description: Relay terminal-state notifications and an authenticated Neo Mobile Chat feed with orchestrator messaging.
requires:
  skills:
    - daemon-service-manage
---

# Chat Gateway

## Service owner and behavior

One service, chat-gateway/server, monitors Relay terminal events and reconciles with the dashboard. It pushes completion events through the existing Neo.app notification system, and silently baselines pre-existing jobs. It also persists optional orchestrator reports and owner submissions in a private append-only ledger. It never reads raw ChatGPT streams or job prompts. No Relay, Events Bus, dashboard, or Neo.app internals are modified.

The loopback MCP service at http://127.0.0.1:8791/mcp is federated into authenticated Neo.app as tool mcp.chat-gateway, accepting these command subcommands:

- chat_report: text (1..2000 characters), optional level info/attention, jobId and needs. Info persists silently; attention may push. Do not require per-turn reports.
- chat_env: office/home mode and source, plus phone connection observation if available.
- chat_feed: optional limit 1..100, default 50. Returns owner-safe job completion/report/owner history with no raw prompt or path.
- chat_jobs: optional limit 1..100, default 100. Returns active and recent Relay jobs from the dashboard, containing only ID, title, status, repository and update timestamp; supplies the separate Neo Mobile Jobs tab.
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
