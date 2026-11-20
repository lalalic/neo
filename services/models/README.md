# Neo common model API (`models.qili2.com`)

This is a **generic model transport**, not a Neo Project or a ToyAlive service.
Models `chatgpt` and `z` receive the caller's API input but forward **only the latest
user message** to the corresponding browser Thread through WebHelm. Codex system,
developer, permissions, Skills, escalation text and previous messages are not
resent to either site. ChatGPT retains its connected Neo MCP tools and uses
the Events Bus for response delivery. Z.ai completes via verified webpage SSE
(`chat:completion`, `done=true`) and does not have those MCP tools. Codex
tool calls are not forwarded.

## Endpoints

- `GET /v1/models` lists `chatgpt` and `z` using the standard OpenAI `data` format.
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

## Stateful ChatGPT Thread contract

One Codex conversation has **one independent persistent Web Thread per model**.
The exact key is `(Codex Thread UUID, model)`; switching from `chatgpt` to `z`
starts or resumes the Z.ai Thread, and switching back resumes the previous
ChatGPT Thread. `neo` remains a hidden compatibility alias for `chatgpt` and
is accepted by the API without appearing in model discovery. For a request
without a Codex UUID, explicit `metadata.session_id` has the same per-model
isolation. Never identify a conversation by comparing message text.

ChatGPT transport:

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
   an automatic re-submission, and return an explicit failure or pending state.

Z.ai transport uses WebHelm `platform run z new-thread` and `new-turn` in
owned, default `WebHelm` Sessions. Each Session starts on `about:blank`, so the
Z Action can install hidden-tab initialization support and its SSE verifier
**before** navigating to Z.ai. A short-lived token is supplied only in the
private chat Prompt, never in a URL or query string. The Z Action's native
in-page submit bridge and same-Thread navigation guard must be deployed with
this Gateway; see the separate `webhelm-actions` Z hotfix branch.
It **automatically issues a fresh one-hour
Neo MCP interactive access token on Neo Master** (`neo mcp token issue
--output ...`, using the installed `/opt/homebrew/bin/neo` by default).
The initial Z.ai message is the exact bootstrap instruction, with the fresh
token included in that private Z.ai chat Prompt:

```text
bootstrap the chat with https://neoy.qili2.com/files/z-chat/bootstrap.md with token <one-hour-access-token>.
```

The Gateway waits for a verified site SSE completion containing
`NEO_BOOTSTRAP_PASS`, persists the verified Z.ai thread URL, and **only then**
submits the caller's latest user text as `new-turn` on that thread. If bootstrap
fails (`NEO_AUTH_REQUIRED`, `NEO_TOOL_UNAVAILABLE`, `NEO_BOOTSTRAP_BLOCKED`,
missing verification, or uncertain submission), the user task is never sent
and no automatic resubmission occurs. On Codex resume or subsequent Turns,
the same Z.ai Thread is reused without reissuing a token or rebootstrapping.
The token handoff file is mode `0600` inside a private temporary directory and
is removed after submission; no secret enters the Gateway response, persisted
state, Git, or normal logs. The short-lived credential is disclosed only to
the **private Z.ai thread** and the Z.ai model may use it for Neo MCP POST.
It is not the Model Gateway Bearer token or Neo's master/operator credential.
The short-lived token expires after one hour; automatic renewal for older
threads is **not yet implemented** and an expired Z.ai session must not be
silently treated as authenticated.

After verified Z bootstrap, each Z.ai `new-turn` Action submits only plain
latest user text, with `wait:true`. A verified final answer requires a
nonempty completion from the website's own SSE (`chat:completion`, `done=true`),
then the Gateway records it and completes the OpenAI Responses SSE. Z.ai
receives neither ChatGPT's `enforcement_context`, `@Neo`, Events Bus
instructions nor ChatGPT Project IDs. A pending/ambiguous submission is not
retried; its WebHelm Session is retained for manual reconciliation. Z.ai is
text-only and image requests fail explicitly. No site-specific model or
thinking effort is imposed, so the site uses its own current/default model.

The Z.ai Action detects the known "A fresh new interface" onboarding overlay
and fails before typing to avoid false submissions. Close that overlay in the
Z.ai browser before first use. Z.ai's site may spend several minutes executing its tools. The Gateway now
submits the prompt **exactly once** with `wait:false`, verifies the durable
Thread and accepted user message, then uses the original WebHelm Session's
`resume:true` (read-only, no submission) to await verified `done=true`.
Each WebHelm action poll has a 90-second deadline and the overall site
completion budget is 540 seconds by default. If the budget expires, the
original browser Session is retained for manual reconciliation; never
resubmit the prompt or fake completion. In-flight bootstrap one-hour tokens
remain valid until expiry, whereas definitively rejected bootstrap tokens
are revoked. No submission text or access token appears in a URL.

**Codex Thread identity and resume.** The Codex HTTP Responses client sends its
stable UUID as `thread-id` (or legacy `thread_id`). This ID is the primary,
exact match to the persisted Gateway Session `codexThreadId` **and model**,
whose `threadId` contains the verified site Thread ID. The full mapping is kept on disk in
`~/.local/share/neo/model-gateway/sessions/` and survives Gateway restarts.
`codex resume <UUID>` sends the same Codex identity and continues the same
site-specific Thread, including when the request contains only the latest user turn.
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
model-specific MCP response tool is needed. The older `mcp.models chat_report`
and `report.mjs` remain available for existing clients/requests during migration,
but the new model turn instructions use reply events. Event transport is enabled
by default; `NEO_MODEL_REPLY_EVENTS=0` is a diagnostic opt-out, not a supported
production fallback. A publish receipt alone is never model-completion proof.
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
The shared service source is `services/models/start.mjs`. Its private request,
response, image and session journal defaults to `~/.local/share/neo/model-gateway`
(0700 directories, 0600 metadata). A local-only experimental deployment may
use `NEO_MODEL_GATEWAY_PORT=8771`.

The retained 3D provider, if configured, is reached through
`NEO_MODELS_LEGACY_ORIGIN=http://127.0.0.1:8770`. No ToyAlive-specific prompt
or data shape is required by the common model API. The old provider is a
migration backend for 3D routes and historical response IDs only.

Run the relevant regression suite with:

```sh
node --test test/model-gateway.test.mjs
```

The local Codex profile remains `~/.codex/neo.config.toml`, with `model=neo`
and `base_url=http://127.0.0.1:8769/v1` on Neo Master.

### URL-prefilled ChatGPT submission

The Neo Models Gateway uses WebHelm's `new-thread` and `new-turn` Actions to
open `https://chatgpt.com/?prompt=...` or `/c/<thread_id>?prompt=...`. The
Actions observe navigation and the Send/Stop controls, click Send **once** when
needed, and require verified delivery. No rich-editor manipulation, injected
structured `@Neo` mention, explicit model selection, or Thinking override is
part of the default route. `NEO_MODEL_APP_MENTION` is an explicit opt-in to
structured App selection; the WebHelm Action handles this separately.

**Release gate:** verify in a real Codex/ChatGPT thread that the connected
Events Bus publish tool remains accessible when no structured App mention is
provided. Do not assume a passing URL navigation test alone proves model
completion; every model turn still requires independent `reply.completed`.
Do not use a dedicated Neo Models browser Tab Group.

## Selecting a backend

Both names use the same authenticated `/v1/responses` and
`/v1/chat/completions` endpoints:

```json
{"model":"chatgpt","input":"hello","stream":true}
```

```json
{"model":"z","input":"hello","stream":true}
```

To select in Codex, configure the existing Neo provider with `model = "chatgpt"`
or `model = "z"` (or choose the model from Codex's model picker). The provider
URL and Bearer token remain unchanged. The old `model = "neo"` continues to
route to ChatGPT for existing clients but is hidden from `/v1/models`.

The standard Codex 3-MVP release gate exercises the ChatGPT Events Bus. Z.ai
requires a separate **real WebHelm browser** new-thread/new-turn test because
it completes by site SSE rather than Neo MCP. A unit test or fabricated receipt
cannot establish Z.ai live availability.
