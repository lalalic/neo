# Neo Local Escalation (Neo Master)

`neo escalation --handoff-file PATH` runs one synchronous local Agent task.

## Default on Apple Silicon

- Agent runtime: Hermes Agent one-shot, with its `terminal` and `skills` toolsets.
- Inference: `llama-server` with Apple Metal, launched for this escalation only.
- Model: `unsloth/Qwen3.5-4B-GGUF:Q4_K_M` at 4-bit, 65,536 context, single slot, q8_0 KV cache.
- Task rules: `agents/escalation.agent.md`, loaded as a temporary `AGENTS.md` in the Agent's working directory (system-level local rules). The one-shot handoff remains a separate file.
- Basic actions: existing WebHelm Skill/CLI, `neo computer-use` CLI, and local Shell. When truly nondelegable: wechat-bro File Helper, then iMessage.
- End of call: Hermes process exits; the owned inference server receives SIGTERM, then SIGKILL if needed. The model stays **on disk only**, not in RAM.

There is no dedicated forever-running model service or dependency on Worknode. Loading a cold model takes longer than keeping a warm server, but frees memory between escalations.

## Configuration

Set environment variables in the `neo` caller's environment, including the shell launched by Neo MCP:

```sh
export NEO_ESCALATION_BACKEND=local  # default: local; use codex explicitly for legacy behavior
export NEO_ESCALATION_ENGINE=llama    # llama (default), mlx, external
export NEO_ESCALATION_MODEL=unsloth/Qwen3.5-4B-GGUF:Q4_K_M
export NEO_ESCALATION_CONTEXT=65536
export NEO_ESCALATION_MAX_TURNS=24
export NEO_ESCALATION_BUDGET_SECONDS=900
```

Optional:
- `NEO_ESCALATION_SERVER_COMMAND`: path to `llama-server` or `mlx_lm.server` (replaces inference process binary).
- `NEO_ESCALATION_AGENT_COMMAND`: path to `hermes`.
- `NEO_ESCALATION_STARTUP_MS`: cold start and first-time download wait (default 900000).
- `NEO_ESCALATION_ENGINE=mlx` plus `NEO_ESCALATION_MODEL=mlx-community/Qwen3.5-4B-MLX-4bit`: use an installed compatible MLX-LM server. MLX is optional and must be tested before use in production.
- `NEO_ESCALATION_ENGINE=external` plus `NEO_ESCALATION_BASE_URL=http://127.0.0.1:PORT/v1`: use an existing local OpenAI-compatible endpoint. Neo does **not** own or unload that endpoint.
- `NEO_ESCALATION_BACKEND=codex`: previous synchronous Codex runner. No silent model/provider fallback is performed by the Neo CLI.

To change model, update the env variable; no edits to Agent instructions or CLI code. Hugging Face GGUF references or absolute `.gguf` file paths are accepted for llama.cpp. Ensure the selected model supports tool calling with Hermes.

## Installation on Neo Master

```sh
brew install llama.cpp
# Install Hermes CLI from the official release or your trusted package mirror.
# Verify both are available:
command -v llama-server
command -v hermes
```

The GGUF is downloaded on first invocation if not already cached; subsequent calls reuse the disk cache. This is not a model kept in memory.

## Local Agent health check

```sh
neo escalation test
```

This creates a private, short-lived file containing a random 128-bit value, sends **only the file path** to the Local Agent, and requires the Agent to call Shell to read the unknown value. The CLI checks the returned evidence against the original value, checks that Hermes actually called a tool (via its event stream), and verifies that Neo's owned inference-server PID has exited. All temporary files are deleted. The test does not open websites, send notifications, or ask for human participation. Success returns JSON with `status: "pass"`; a nonzero exit or mismatch means the agent is not ready.

This test covers the inference runtime, Agent tool calling, result integrity, and model cleanup. To separately check the desktop and browser entry points without performing mutations:

```sh
neo computer-use call list_apps
webhelm status
```

It does not establish that arbitrary multi-step website tasks, GUI actions, or human notifications work; validate those with separate controlled tasks when they are required.

## Call/return contract

```sh
neo escalation --handoff-file /absolute/path/to/handoff.md
```

The CLI waits for the local Agent to finish and returns one JSON result with `status=resolved|needs_user|failed`, `summary`, `reason`, `user_action`, `evidence`, and `notification`. The CLI does not create a Relay Job or queued task. Hermes sees the escalation Agent rules as `AGENTS.md`; original task directory is explicitly passed in the handoff. Its file contains the user instruction separately.

When human-only MFA, biometric, payment, legal confirmation, or secrets are required, the Agent should send a concise wechat-bro File Helper message, fall back to iMessage if undelivered, and return `needs_user` rather than waiting for a person during this synchronous call.

Tool calls and cloud services remain constrained by the governing provider/runtime rules and original user authorization.

## Experience recording

Every real local escalation records a private, deduplicated scenario/solution candidate, including failures; if necessary the same local model performs one tool-free post-run summarization before unloading. Inspect with `neo escalation cases`. See [Escalation Experience](escalation-experience.md).

## Diagnostics

```sh
neo computer-use call list_apps
webhelm status
hermes --version
llama-server --version
```

A local backend failure must return a real error; it must never be reported as `resolved`. After a call, verify no **owned** `llama-server` PID remains.
