# Models Gateway native Rust migration

## Outcome
Replace the standalone Node Models service with a Rust binary in the Neo repository, without changing caller contracts or adding a second live owner. The service owns generic /v1 Models and Orchestrator Chat. Events Bus and WebHelm remain independent existing services.

## Acceptance
- Native OpenAI and Codex catalogs, Responses nonstream and SSE, Chat Completions, and authenticated loopback provider proxy. Retain request limits, exact thread identity and durable response/session schema.
- Native WebHelm transport using existing shared WebHelm Actions; never use a dedicated Models or Relay browser group. Latest user text/images only; exact response correlation; explicit terminal reply events, duplicate sequence handling, timeout and uncertainty. Native NATS subscriber; no Node worker or HTTP compatibility proxy for model execution.
- Native Orchestrator adapter retains verified head CAS, idempotent durable FIFO, staged attachments, one-complete-envelope reply, SSE replay/ACK, APNs attention delivery and Relay event/watch wakeup ledger. Existing state opens without destructive migration.
- Preserve external 3D proxy as an independent provider. Retire obsolete direct report/MCP path only after proving no active consumer, otherwise port its necessary interface. No new model transport or alternative browser pool.
- Port/replace behavioral regression tests, compare public API/state with existing reference fixtures, test restart/recovery/auth and negative cases. Build candidate on port 8786 with isolated state. All three actual Codex MVPs in services/models/MVP_GATE.md must pass before merge. Live deployment and repeated MVPs are separate release gates; keep current production untouched until candidate passes.
- Preserve current credentials, Orchestrator mapping, pending requests, leases, and unrelated worktrees; no private data in git.
