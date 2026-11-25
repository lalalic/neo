# Neo common model API (`models.qili2.com`)

This is a **generic model transport**, not a Neo Project or a ToyAlive service.
Model `neo` receives the caller's complete API input but forwards **only its latest
user message** to a stateful ChatGPT Thread through WebHelm. Codex system,
developer, permissions, Skills, escalation text and previous messages are not
resent to ChatGPT. The latest user message supplies the task; connected Neo
MCP tools remain available to ChatGPT. Codex tool calls are not forwarded.

## Endpoints

- `GET /v1/models` lists `neo` using the standard OpenAI `data` format.
  `GET /v1/models?client_version=0.165.0` serves the Codex Models catalog
  (`models: [{slug, display_name, ...}]`) with neutral base instructions.
  Codex expects that richer schema for its model picker and configuration;
  it is distinct from the public OpenAI model-list format. No separate
  `/models` route is required with a provider base URL ending in `/v1`.
- `POST /v1/responses` supports Responses text and bounded base64 PNG/JPEG/WebP images.
  With `stream:true` it returns Responses SSE; otherwise it returns a 202
  `in_progress` response ID. `GET /v1/responses/<id>` returns durable status
  and actual result, never a fabricated completion.
- `POST /v1/chat/completions` accepts an OpenAI-style message list and returns
  a Chat Completion (streaming or non-streaming).
- Existing `/api/v2/rodin`, `/api/v2/status`, `/api/v2/download` and
  `/api/v2/rodin/assets/<id>` capabilities are proxied to a separately running
  provider adapter on **loopback**. This preserves model catalog and API
  ownership without importing ToyAlive Agent logic. Older response IDs are
  also forwarded to that provider for in-flight request compatibility.

## Neo Mobile Orchestrator adapter (separate from generic `/v1`)

The same running Models service also exposes authenticated
`/orchestrator-chat/*` REST/SSE routes to the existing Neo.app/Core HTTPS
facade. The phone uses its **already paired Master bearer**; it does not need
an independent Chat Gateway provider, new public listener, or a second
credential. Models imports the existing verified Orchestrator Project/head
mapping once rather than creating a competing ChatGPT Thread.

- `POST /orchestrator-chat/messages`: durable 202 receipt only; client supplies
  stable `requestId` and matching `Idempotency-Key`. Duplicate acceptance
  does not resend an uncertain ChatGPT turn.
- `POST /orchestrator-chat/attachments`: bounded staged chunks before message
  acceptance; never continue uploading after a request is durably accepted.
- `GET /orchestrator-chat/pending[?requestId=...]`: reconcile accepted requests,
  completed/un-ACKed responses and the event cursor, including lost 202s.
- `GET /orchestrator-chat/events?cursor=N`: status SSE with monotonic IDs;
  cursor expiration returns 409, which requires `/pending` reconciliation.
- `POST /orchestrator-chat/ack`: after the phone persists a terminal reply,
  ACK the stable delivery ID and scrub retained operational text/files.
- `GET /orchestrator-chat/health`: redacted readiness and queue counters.

The Orchestrator adapter requires **one complete**
`neo.orchestrator.reply.v1` JSON envelope in an Events Bus `reply.text`
`seq=1`, plus a separate `reply.completed`. Do not confuse this with the
multi-fragment generic `/v1` reply protocol. Routine completed chat uses
in-app delivery; APNs is reserved for attention, failures and owner actions.
The permanent display transcript belongs to Neo Mobile, not Models.

See [the current Orchestrator contract](../../docs/models-orchestrator.md)
and [the generic Model CLI release gate](MVP_GATE.md). Verified phone
Send/receive and relaunch recovery do not substitute for a separate real
A→B→C browser handoff or this generic model gate.

## Stateful ChatGPT Thread contract

One client conversation corresponds to one persistent ChatGPT Thread:

1. First model request -> WebHelm `new-thread`; save verified `thread_id`.
2. Subsequent request -> `new-turn` with the **same** `thread_id`.
3. Only submit the new message(s). ChatGPT already retains conversation history.
4. Each WebHelm turn has a **task** (`message`: only the latest user message)
   and an optional **enforcement_context** (the reply-event contract from
   `TOP_INSTRUCTIONS.md` plus the current `response_id`). The generic WebHelm
   transport wraps enforcement_context in `<top-instructions>...</top-instructions>`
   and presents it before the task.
   No other Codex messages, history or tools are forwarded. The Gateway still
   stores the latest caller request as a diagnostic snapshot, while ChatGPT
   retains its history in the persistent browser Thread. Only the latest user message's images
   are materialized as attachments. WebHelm handles long prompt transport.
5. ChatGPT calls the **existing Events Bus** MCP `publish` tool with source
   `reply/models/<response_id>`. `reply.text` carries `{seq,text}` and streams
   a `response.output_text.delta`; it never ends the Turn. A **separate**
   `reply.completed` closes the request with `response.completed` and SSE closure.
   `reply.heartbeat` extends the 9-minute inactivity timeout (30-minute maximum);
   `reply.failed` with `{error}` ends in `response.failed`. The Models listener
   validates the ID and sequence and writes to the existing response store.
   No model reply routes to Neo Mobile. See the canonical
   [channel developer contract](../../skills/events-bus/references/channel-development.md).
6. If WebHelm submission/completion is uncertain, preserve the state, refuse
   an automatic re-submission, and return an explicit failure or pending state. A pending Send receipt can recover the original Thread from its owned browser session URL. Every 60 seconds while awaiting a terminal reply, Models invokes the existing WebHelm `validate_new_turn_ready` in the owned Thread, with the actual continuation prompt. READY permits a single same-response-ID continuation reminder for that check, with a fresh idempotency key. NOT_READY or a validation error skips the check. The ordinary new-turn action owns the final Send readiness check. No message, composer, Stop or assistant DOM inspection is added by recovery. No task replay, synthetic reply, or fixed post-reminder deadline; the existing inactivity and maximum request limits remain. An uncertain send fails closed.

**Codex Thread identity and resume.** The Codex HTTP Responses client sends its
stable UUID as `thread-id` (or legacy `thread_id`). This ID is the primary,
exact match to the persisted Gateway Session `codexThreadId`, whose `threadId`
contains the verified ChatGPT Thread ID. The full mapping is kept on disk in
`~/.local/share/neo/model-gateway/sessions/` and survives Gateway restarts.
`codex resume <UUID>` sends the same Codex identity and continues the same
ChatGPT Thread, including when the request contains only the latest user turn.
Codex's `session-id`/`session_id` header can represent cache affinity rather
than stable conversation identity; never use it for routing without `thread-id`.

Binding order: `previous_response_id` (with owner ID validation), exact Codex
`thread-id`, then explicit `metadata.session_id` for non-Codex clients.
`metadata.codex_thread_id` is an explicit alternative for callers not using
Codex headers. If none are supplied, **each** POST starts a new conversation.
There is **no message content matching or history-prefix fallback**, even for
identical `hello` messages. A Codex item `id`, when available, distinguishes an
exact retried user item for safe idempotency without comparing its text.
Unconfirmed submissions remain blocked within their owning Codex Thread.

Only the latest user message is forwarded to ChatGPT. Other incoming roles,
history and tool results are not used for routing or forwarding. The latest
incoming transcript is stored for diagnostics, not identity resolution.

The Events Bus MCP `publish` tool is shared with Job lifecycle events; no
model-specific MCP response tool is needed. The older `mcp.models chat_report` and `report.mjs` are retired. Event transport is enabled by default; `NEO_MODEL_REPLY_EVENTS=0` is a diagnostic opt-out, not a supported production fallback. A publish receipt alone is never model-completion proof.
Neither the input nor the output is size-routed through Gateway-generated files.

## Inline top instructions (no ChatGPT Project required)

Every Turn passes the reporting contract from `TOP_INSTRUCTIONS.md` as an
optional `enforcement_context` field to the WebHelm transport. WebHelm wraps
it in `<top-instructions>` at the beginning of the ChatGPT message. The
contract is the same for the first and all subsequent Turns. A ChatGPT Project is not
required; an existing Project-bound Thread can still be used if configured.

If the message exceeds WebHelm's 2,000-character direct-send threshold, the
full exact **task** is uploaded as `prompt.md`. The visible composer retains
`<top-instructions>`, the `response_id`, and the instruction to read `prompt.md`
within that size limit, so the model sees the reporting requirements before
opening the attachment. These are WebHelm transport details, not additional
model context or historical messages.

## Deployment and privacy

On Neo Master, the public HTTPS Tunnel still targets `127.0.0.1:8769`.
The existing Auth Bearer token remains in `~/.config/neo/models/token` (0600).
The shared service source is `services/models/src/` (Cargo package `neo-models`). The canonical launchd service runs the native executable with `NEO_MODELS_LIVE=1`. Its private request,
response, image and session journal defaults to `~/.local/share/neo/model-gateway`
(0700 directories, 0600 metadata). A local-only experimental deployment may
use an explicit isolated `NEO_MODELS_STATE_DIR` and `NEO_MODEL_GATEWAY_PORT=8786` without live mode.

The retained 3D provider, if configured, is reached through
`NEO_MODELS_LEGACY_ORIGIN=http://127.0.0.1:8770`. No ToyAlive-specific prompt
or data shape is required by the common model API. The old provider is a
migration backend for 3D routes and historical response IDs only.

Run the relevant regression suite with:

```sh
cargo test --locked -p neo-models
cargo build --locked -p neo-models
python3 services/models/tests/gateway_fixture.py target/debug/neo-models
python3 services/models/tests/relay_monitor_fixture.py target/debug/neo-models
```

The local Codex profile remains `~/.codex/neo.config.toml`, with `model=neo`
and `base_url=http://127.0.0.1:8769/v1` on Neo Master.

### URL-prefilled ChatGPT submission

The Neo Models Gateway uses WebHelm's `new-thread` and `new-turn` Actions to
open `https://chatgpt.com/?prompt=...` or `/c/<thread_id>?prompt=...`. The
Actions observe navigation and the Send/Stop controls, click Send **once** when
needed, and require verified delivery. No rich-editor manipulation or injected structured `@Neo` mention is part of the default route. On a new Thread, explicitly supplied Responses `reasoning.effort` (or Chat Completions `reasoning_effort`) is mapped to the WebHelm `thinking_level` best-effort option; a missing picker or failed verification is nonfatal. Subsequent Turns inherit the Thread setting. `NEO_MODEL_APP_MENTION` is an explicit opt-in to
structured App selection; the WebHelm Action handles this separately.

**Release gate:** verify in a real Codex/ChatGPT thread that the connected
Events Bus publish tool remains accessible when no structured App mention is
provided. Do not assume a passing URL navigation test alone proves model
completion; every model turn still requires independent `reply.completed`.
Do not use a dedicated Neo Models browser Tab Group.

Models owns native Orchestrator helpers in `src/`. Bootstrap an existing verified head using `orchestrator/bootstrap-head.json` only if the durable mapping is absent. Optional imported watch seeds live under `orchestrator-watch-bootstrap/` in the Models state directory. No standalone Chat Gateway service or MCP is required.
