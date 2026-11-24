# Neo Orchestrator Chat — current contract (2026-11-21)

This document supersedes the old Phase 1 instructions to manually call
`mcp.chat-gateway chat_report`, `chat_bind`, and `chat_send` for every Neo Mobile
turn. **Do not paste those old instructions into the ChatGPT Project.** The
current Models service supplies the per-turn Orchestrator enforcement context.
The generic `/v1/responses` model API has a separate reporting contract.

## Ownership and route

- **Neo Mobile** owns its visible chat transcript, durable outbox, attachment
  staging, and last processed event cursor. It keeps those through foreground
  changes and app restarts; clearing phone history is a local action.
- **Neo.app/Core** authenticates the phone's existing saved Master bearer and
  proxies the same-origin `/orchestrator-chat/*` routes. Bonjour never supplies
  tokens. The paired `com.neox.app` keeps its Keychain credential across an
  in-place installation of the same bundle identity; a different bundle ID
  cannot assume access to it.
- **Neo Models** (`services/models/start.mjs`, loopback `127.0.0.1:8769`)
  owns request acceptance, durable operational queue/events, strict
  idempotency, the fixed Codex-to-ChatGPT Thread mapping, verified Project
  head, and generation-checked successor handoff. It does **not** own a second
  permanent phone transcript.
- **WebHelm** submits the turn to the existing verified ChatGPT head. A new
  head is never inferred from text similarity, a reply claim, or an unverified
  Project URL.
- **Events Bus** `publish` is the reply transport. There is no Orchestrator
  `chat_report` MCP call and no chat-specific replacement publisher tool.

Authenticated owner routes (the public HTTPS facade uses the *same* paths):

| Route | Purpose |
| --- | --- |
| `POST /orchestrator-chat/messages` | Accept one message with stable `requestId`; require `Idempotency-Key` equal to that ID; return 202 on durable acceptance |
| `POST /orchestrator-chat/attachments` | Stage bounded, idempotent attachment chunks **before** accepting the message |
| `GET /orchestrator-chat/pending` | Recover unacknowledged results and cursor; optional `?requestId=` detects an already accepted retry |
| `GET /orchestrator-chat/events?cursor=N` | Authorized SSE stream with monotonic IDs, replay, 15-second heartbeat, and 409 on expired cursor |
| `POST /orchestrator-chat/ack` | ACK terminal `deliveryId` **after** persisting the reply on the phone; scrub message/attachment data from operational state |
| `GET /orchestrator-chat/health` | Redacted service readiness and queue counters; 503 if existing head mapping is not verified |

## Model-side reply contract

The Orchestrator publishes **one complete JSON envelope** in `reply.text`
`seq=1`, using source `reply/models/<response_id>`, followed by a separate
`reply.completed`. Do not stream multiple text fragments from this Orchestrator
adapter (generic `/v1` calls may have their own multi-segment behavior).
The envelope is validated server-side:

```json
{"schema":"neo.orchestrator.reply.v1","message":{"text":"Completed the requested check.","level":"info","needs":"none"}}
```

`level` is `info` or `attention`; `needs` is `none`, `phone`,
`work_node`, or `retry`; `jobId` is optional. A *control* envelope may
request `replace-thread-id` only after the Orchestrator creates a real
successor in the **same ChatGPT Project**, with its first user turn containing
`neo.orchestrator.handoff.v1`, the exact `previousThreadId`,
`expectedGeneration`, and a unique `handoffReceipt`. Models independently
verifies both successor Project URL and receipt in the same browser Session,
then performs persisted compare-and-swap. A control claim is never proof of
successful handoff. Do not manually edit the head mapping.

## Mobile delivery and notifications

A 202 submission receipt is **not** an assistant reply. The phone persists the
owner message first, listens for SSE events, persists each complete reply,
then ACKs its delivery. While Chat is visible it also reconciles `/pending`
periodically, so a completed response remains recoverable if SSE stalls or the
app restarts. No second submission may be fabricated for an uncertain browser
turn. On expiry (SSE 409), reconcile `/pending` before advancing the cursor.

**Ordinary completed chat messages use the in-app history/SSE path, not APNs.**
APNs is reserved for failures, `attention`, and explicit owner `needs`. Apple
acceptance alone never proves that the alert appeared on a physical phone.
Relay Jobs/Review use separately authenticated `/relay/api/mobile/*` REST
routes and their existing owner-safe lifecycle data. Models owns the Relay event/watch behavior; there is no separate Chat Gateway MCP service.

## Verification and deployment

Check Models regression with `node --test test/model-*.test.mjs`, verify the
authenticated health/pending/events endpoints (unauthenticated 401 is
expected), and use **real NeoUse on paired iPhone 17** for message entry,
Send, actual bubble receipt, and app-relaunch history recovery. A UI tap
success is not evidence that text entered the composer: inspect the visible
reply and, when diagnosing, the phone-owned local outbox/history.

The November 21 physical-phone check confirmed a short `qa` request reached
`submitted`, its assistant reply reached `completed`, and both survived app
relaunch. The generic Models Codex CLI release gate is documented separately
in [`services/models/MVP_GATE.md`](../services/models/MVP_GATE.md); a mobile
REST/SSE smoke test does not replace that gate, nor prove a complete real
A→B→C WebHelm browser handoff or background APNs display.

The canonical live Models service is launchd `com.neo.models.gateway`; use
its existing source-backed configuration and restart that **one** service only
when the currently accepted operational state can be preserved. Do not start
an independent public listener, repoint a PM2 service to a disposable
worktree, or enable a duplicate NATS ingress while migrating.
