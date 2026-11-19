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

## Stateful ChatGPT Thread contract

One client conversation corresponds to one persistent ChatGPT Thread:

1. First model request -> WebHelm `new-thread`; save verified `thread_id`.
2. Subsequent request -> `new-turn` with the **same** `thread_id`.
3. Only submit the new message(s). ChatGPT already retains conversation history.
4. Each WebHelm turn has a **task** (`message`: only the latest user message)
   and an optional **enforcement_context** (the `chat_report` contract from
   `TOP_INSTRUCTIONS.md` plus the current `response_id`). The generic WebHelm
   transport wraps enforcement_context in `<top-instructions>...</top-instructions>`
   and presents it before the task.
   No other Codex messages, history or tools are forwarded. The Gateway still
   stores caller input for session matching, and ChatGPT retains its own history
   in the persistent browser Thread. Only the latest user message's images
   are materialized as attachments. WebHelm handles long prompt transport.
5. ChatGPT calls the dedicated MCP `mcp.models chat_report` tool one or more
   times with `{response_id, text}`. Each call appends to one assistant output
   item and streams a `response.output_text.delta`; a text report never ends
   the Turn. ChatGPT must explicitly send `{response_id, completed:true}` after
   the final report for `response.completed` and SSE closure. A `heartbeat:true`
   updates liveness without an output item and extends the 9-minute inactivity
   timeout (30-minute maximum). A terminal `{response_id, error}` signals
   `response.failed`. No gateway request/output files are generated based on
   message size. Do not confuse this tool with Neo Mobile's chat-gateway tool.
6. If WebHelm submission/completion is uncertain, preserve the state, refuse
   an automatic re-submission, and return an explicit failure or pending state.

Binding order: `previous_response_id`, `metadata.session_id` (when supplied),
or the **unique longest** saved message-history prefix. This supports Codex
`store:false` full-history submissions without resending history to ChatGPT.
Ambiguous matching is rejected rather than silently mixing two conversations.
For strongest isolation, API clients should supply a unique stable
`metadata.session_id` for each independent conversation.

The latest user message is authoritative for the current Turn. The Gateway
uses the other incoming messages only for identifying the correct stateful
conversation. It does not pass Codex developer/system, Escalation Requests,
Skills or previous assistant/user messages to ChatGPT, even for a first Turn.

Install the response tool in Neo Master MCP Federation (one time) with:

```sh
neo setup mcp add models 'stdio:///opt/homebrew/bin/node?arg=/Users/chengli/Workspace/neo/services/models/mcp.mjs'
```

Use `neo setup mcp list` to confirm `mcp.models chat_report` is healthy.
The model response tool is separate from `mcp.chat-gateway chat_report` and
must **never** send result text to the phone. The previous generic `report.mjs`
CLI remains as a compatibility path for already-submitted older requests;
new model turns use the MCP tool instead. Neither the input nor the output
of a new text request is size-routed through gateway-generated files.

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
