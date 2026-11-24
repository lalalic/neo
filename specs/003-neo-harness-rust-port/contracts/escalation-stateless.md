# Native stateless local inference tool-loop (T017 sub-slice)

`escalation_stateless` implements the in-memory OpenAI-compatible local
model-message/tool-call/decision state machine in Rust, **without** exposing
raw tool execution or starting a real model service by itself.

## Model and authority boundaries

- Inference endpoints accept **only**
  `http://127.0.0.1:PORT/v1/chat/completions`. The native HTTP client uses
  POST JSON, a caller-provided bounded timeout, 2 MiB response limit and
  no HTTP redirect following. No provider login, cloud account or external
  model address is implicit.
- Each model action turn offers explicit `shell`, `webhelm`,
  `computer_use`, and owner-authorized `credential_fill` tool definitions.
  The tool implementation is **not** exposed by this module: it accepts a
  trusted injected executor callback. Unknown tool names fail locally,
  without executing an arbitrary command.
- At most **four** tool calls from each assistant batch are accepted, each
  receives its matching tool-result event and Tool ID. Tool outputs are
  limited before reentering the model, and original tool content remains
  in the temporary in-memory session, never persisted as a transcript.
- After every executed batch, a second model request has `tool_choice:none`
  and a clear status-check prompt: finish only after actual verification, or
  explicitly request another authorized step with `continue:true`.
  Incomplete `{done:...}` answers restore tool access rather than becoming
  terminal outcomes.
- The normalizer/evidence gate rejects a `resolved` result that has no
  successful real Tool Result. Invalid terminal JSON, unsupported status,
  `needs_user` without required action, bad model messages, exceeded budgets
  or max tool turns fail explicitly. The future command launcher must still
  redact results before printing or recording any public-facing summary.

## Acceptance evidence (2026-11-23)

- **7 Rust tests** passed: exact event semantic parity with the Node
  stateless agent for one Tool/Decision sequence; continuation and invalid
  JSON decision repair; denial of unsupported model-requested tool; four-call
  cap; refusal of success without tool evidence; turn-budget rejection; and
  a real disposable local TCP JSON endpoint with no external request.
- Original `node --test test/neo-stateless-agent.test.mjs`: **6/6** passed.
- Entire Rust integration suite: **130/130**, strict Clippy passes.
- No actual Shell/WebHelm/Computer Use mutations, model download, owner
  credential, production file or service was accessed. The trusted tool
  executor, model process startup/shutdown, Challenge/Experience orchestration
  and terminal end-to-end integration remain open in T017. This is a verified
  library primitive, **not a production-ready Escalation command**.
