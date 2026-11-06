# Neo Local Escalation (Neo Master)

`neo escalation --handoff-file PATH` always runs one synchronous local Agent task. There is no backend selector and no Codex fallback.

## Default on Apple Silicon

- Agent runtime: **stateless Neo tool-calling loop** (OpenAI-compatible local API). No Hermes Gateway, session database, chat history, or retained agent thread.
- Inference: `llama-server` with Apple Metal, launched for this escalation only.
- Model: `unsloth/Qwen3.5-4B-GGUF:Q4_K_M` at 4-bit, 65,536 context, single slot, q8_0 KV cache.
- Task rules: `agents/escalation.agent.md` passed as a true model system message. The task handoff is a separate user message. Both exist only in process memory and restricted temporary files during the call.
- Basic actions: existing WebHelm Skill/CLI, `neo computer-use` CLI, and local Shell. When truly nondelegable: wechat-bro File Helper, then iMessage.
- End of call: the Node agent process exits; the owned inference server receives SIGTERM, then SIGKILL if needed. Temporary task files and logs are removed, with no session/thread transcript retained.

There is no dedicated forever-running model service or dependency on Worknode. Loading a cold model takes longer than keeping a warm server, but frees memory between escalations.

## Per-host global inference lock

Every `neo escalation` invocation (including `neo escalation test`) acquires a shared **Neo Master exclusive lock** *before starting its inference runtime*. If another escalation is active, the later caller waits and emits a brief queued status to stderr after 1.2 seconds; the task does not start a second model. The lock covers startup, execution, model shutdown and temporary-data cleanup, and is released automatically on completion, exceptions, cancellation or caller death.

- Default file: `~/.local/state/neo/escalation/inference.lock`. Private 0700 directory and 0600 file. It is kept on disk; never delete it while another Escalation may be running.
- Queue timeout: `NEO_ESCALATION_LOCK_WAIT_SECONDS` (default 3600, allowed 1–14400).
- `NEO_ESCALATION_LOCK_DIR` optionally changes the lock directory for isolated tests; all Neo Master callers must use the **same directory** to serialize their work.
- `neo escalation cases` is read-only and does not need the inference lock.

This is a **per-machine** advisory lock, not a multi-node distributed lock or guaranteed FIFO queue. Worknode or home98 models remain independent. Any legacy escalation process already running before installation of this lock cannot be retroactively serialized.

## Configuration

Set environment variables in the `neo` caller's environment, including the shell launched by Neo MCP:

```sh
export NEO_ESCALATION_ENGINE=llama    # llama (default), mlx, external
export NEO_ESCALATION_MODEL=unsloth/Qwen3.5-4B-GGUF:Q4_K_M
export NEO_ESCALATION_CONTEXT=65536
export NEO_ESCALATION_MAX_TURNS=24
export NEO_ESCALATION_BUDGET_SECONDS=900
```

Optional:
- `NEO_ESCALATION_SERVER_COMMAND`: path to `llama-server` or `mlx_lm.server` (replaces inference process binary).

- `NEO_ESCALATION_STARTUP_MS`: cold start and first-time download wait (default 900000).
- `NEO_ESCALATION_ENGINE=mlx` plus `NEO_ESCALATION_MODEL=mlx-community/Qwen3.5-4B-MLX-4bit`: use an installed compatible MLX-LM server. MLX is optional and must be tested before use in production.
- `NEO_ESCALATION_ENGINE=external` plus `NEO_ESCALATION_BASE_URL=http://127.0.0.1:PORT/v1`: use an existing local OpenAI-compatible endpoint. Neo does **not** own or unload that endpoint.

To change model, update the env variable; no edits to Agent instructions or CLI code. Hugging Face GGUF references or absolute `.gguf` file paths are accepted for llama.cpp. Ensure the selected model supports the local stateless function-calling schema.

## Installation on Neo Master

```sh
brew install llama.cpp
# The stateless agent does not require Hermes.
command -v llama-server
```

The GGUF is downloaded on first invocation if not already cached; subsequent calls reuse the disk cache. This is not a model kept in memory.

## Local Agent health check

```sh
neo escalation test
```

This creates a private, short-lived file containing a random 128-bit value, sends **only the file path** to the Local Agent, and requires the Agent to call Shell to read the unknown value. The CLI checks the returned evidence against the original value, checks that the local agent actually called a tool (using in-memory events), and verifies that Neo's owned inference-server PID has exited. All temporary files are deleted. The test does not open websites, send notifications, or ask for human participation. Success returns JSON with `status: "pass"`; a nonzero exit or mismatch means the agent is not ready.

This test covers the inference runtime, Agent tool calling, result integrity, and model cleanup. To separately check the desktop and browser entry points without performing mutations:

```sh
neo computer-use call list_apps
webhelm status
```

It does not establish that arbitrary multi-step website tasks, GUI actions, or human notifications work; validate those with separate controlled tasks when they are required.

To evaluate credential-recovery prompt enforcement without contacting real providers, run `node scripts/eval-local-escalation-credential.mjs` from the Neo source tree. It creates an isolated mock Worknode, Neo Master credential source and target Secret Store, then checks exact transfer, 0600 permissions, no returned plaintext, and case-summary hygiene. This test may report failure if the small model does not finish the multistep task; do not treat a general Shell smoke test as proof of credential-recovery reliability.

## Call/return contract

```sh
neo escalation --handoff-file /absolute/path/to/handoff.md
```

The CLI waits for the local Agent to finish and returns one JSON result with `status=resolved|needs_user|failed`, `summary`, `reason`, `user_action`, `evidence`, and `notification`. The CLI does not create a Relay Job; it synchronously waits for the exclusive resource lock when needed. The local model receives the escalation rules as a system message, and receives the original task directory and handoff separately. Tool results exist in process memory only; reusable sanitized scenario/solution summaries remain in the private case library.

When human-only MFA, biometric, payment, legal confirmation, or secrets are required, the Agent should send a concise wechat-bro File Helper message, fall back to iMessage if undelivered, and return `needs_user` rather than waiting for a person during this synchronous call.

Tool calls and cloud services remain constrained by the governing provider/runtime rules and original user authorization.

## Plaintext credentials and session-retention policy

Within already-authorized source and target accounts, the Agent may repeatedly use plaintext credentials in memory, stdin or a necessary private temporary file. It may create/provision target Secret Stores in GitHub, npm, Cloudflare, etc. The USD 10 cumulative task/pilot spending ceiling is **independent** of plaintext-use frequency. The CLI masks credential patterns and exact secret values observed in tool responses before returning status, summary, evidence, notification, or user action. This is a best-effort output safeguard; credentials should never be included in Agent final output in the first place.

**No Agent session or thread history is stored.** Model inputs, tool calls and tool outputs remain in the process memory for this escalation only; scratch and model-server logs are deleted in the final cleanup. The existing Neo Experience library keeps only short, redacted scenario/solution metadata and tool names/counts, not raw session transcripts or command output. Other applications' independent browser/account audit histories are not changed by this policy.

## Experience recording

Every real local escalation records a private, deduplicated scenario/solution candidate, including failures; if necessary the same local model performs one tool-free post-run summarization before unloading. Inspect with `neo escalation cases`. See [Escalation Experience](escalation-experience.md).

## Diagnostics

```sh
neo computer-use call list_apps
webhelm status
llama-server --version
```

A local backend failure must return a real error; it must never be reported as `resolved`. After a call, verify no **owned** `llama-server` PID remains.

## Inspect all blocked tasks and their retries

```sh
neo escalation challenges --limit 30
neo escalation --handoff-file /absolute/handoff.md --correlation-id job/example/task/repair
```

Each local attempt persists its full, **unredacted** handoff and a start event before inference. Stage checkpoints and the final result/error are appended as separate private 0600 files. `--correlation-id` keeps retries with changing handoffs together. This ledger is separate from the sanitized deduplicated Experience Library (`neo escalation cases`), never stores a full agent transcript, and never changes the existing public-result redaction. See `docs/escalation-experience.md`.
