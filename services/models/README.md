# Neo common model API (`models.qili2.com`)

This is a **generic model transport**, not a Neo Project or a ToyAlive service.
Model `neo` forwards the caller's system/developer/user messages to ChatGPT
through WebHelm. Task-specific instructions must come from the **caller**, not
from code in this service. ChatGPT may use its already-connected Neo MCP tools;
Codex tools are not forwarded as function calls.

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
4. Each WebHelm turn includes a **small envelope** containing its `response_id`,
   an instruction to use `mcp.models chat_report`, and **only the new messages**.
   The `system`/`developer`/`user` text is included inline by role for ordinary
   inputs (up to 8192 UTF-8 bytes). Larger inputs use a private `.request.json`
   file reference instead; images are always stored as private binary files.
5. ChatGPT calls the dedicated MCP `mcp.models chat_report` tool with
   `{response_id, text}` for answers up to 12000 characters. Large text results
   use the exact `<response_id>.output.txt` path with `{response_id, file}`.
   For real failures, use `{response_id, error}`. The tool writes directly to
   the pending Responses result; ordinary answers require **no** output files.
   `mcp.chat-gateway chat_report` is a different tool that sends owner messages
   to Neo Mobile and must **not** be used for model responses.
6. If WebHelm submission/completion is uncertain, preserve the state, refuse
   an automatic re-submission, and return an explicit failure or pending state.

Binding order: `previous_response_id`, `metadata.session_id` (when supplied),
or the **unique longest** saved message-history prefix. This supports Codex
`store:false` full-history submissions without resending history to ChatGPT.
Ambiguous matching is rejected rather than silently mixing two conversations.
For strongest isolation, API clients should supply a unique stable
`metadata.session_id` for each independent conversation.

The generic dispatch prompt contains a short reporting context on **every**
turn, followed by the actual current-turn message content or a large-input
file pointer. It never mentions ToyAlive, a DAG, a VLM role or any specific
agent. A client may still supply specialized instructions as
`system`/`developer`/`user` message content.

Install the response tool in Neo Master MCP Federation (one time) with:

```sh
neo setup mcp add models 'stdio:///opt/homebrew/bin/node?arg=/Users/chengli/Workspace/neo/services/models/mcp.mjs'
```

Use `neo setup mcp list` to confirm `mcp.models chat_report` is healthy.
The model response tool is separate from `mcp.chat-gateway chat_report` and
must **never** send result text to the phone. The previous generic `report.mjs`
CLI remains as a compatibility path for already-submitted older requests;
new model turns use the MCP tool instead.

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
