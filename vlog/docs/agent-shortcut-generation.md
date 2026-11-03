# Agent Shortcut Authoring

Shortcuts are optional executable counterparts to Agent contracts. Project-specific
roles (such as `vlog-visioner`) own shortcuts under
`<project>/agents/.shortcut/<agent>.agent.mjs`. Reserve shared
`agents/.shortcut/` for behaviors genuinely independent of project sources,
artifact schemas and run paths. Reuse Markcut Vision and its existing CLI,
not a copied inference pipeline. Keep the matching `.agent.md`, project
contracts and eval cases as the source of truth. Do not bypass a Worker when
interactive capabilities or unavailable evidence are required.

## On-demand workflow

1. Read the full shared `<agent>.agent.md`, the target project's `AGENTS.md`,
   stage contract and existing evaluation cases. Record the exact accepted
   inputs, outputs, provenance, hold conditions and human gates.
2. Identify existing CLI tools and supported `--help` options named by those
   contracts. The shortcut may invoke those tools; it must not copy their
   parsing, inference, publishing or evaluation logic.
3. Implement an async `run(context)` function that returns exactly one of
   `COMPLETED`, `WAITING_EVENT` or `FAILED`, with structured contract evidence.
   The context includes an `AbortSignal`; use it for cancellable work. Use the
   host's owned-process runner for subprocesses. A zero exit code is insufficient
   without checking required artifacts and their contents.
4. Reuse approved outputs, refuse to overwrite accepted evidence, and fail
   closed on missing authorization, stale hashes, unsupported CLI behavior,
   malformed output or ambiguous results. Do not infer approval or publishing.
5. Add fixture tests with mocked external commands and the same contract evals
   used for Agent Worker execution. Do not make paid calls, uploads or real
   publication part of tests.
6. Register the shortcut only after focused tests and contract review pass.
   Until then the existing Agent Worker remains the fallback.

There is no arbitrary agent-code generator in this repository. A generated
   draft must be based on the specific `.agent.md` contract and verified CLI help
or templates, and must pass the normal tests/evals before use.

## Vlog Visioner

`vlog/agents/.shortcut/vlog-visioner.agent.mjs` is the first concrete example. It requires
a dated private run, an owner-approved source manifest and a host-provided
owned-process command runner. Existing `input/media/metadata.json` is reused.
Missing metadata requires explicit inference authorization and a configured
authorized ITT/VTT adapter; Markcut Vision must advertise the template options
from the Vlog Visioner contract. The existing
`scripts/index-markcut-vision.mjs` validates source hashes and produces the
intermediate source-linked index. The shortcut derives a separate
`vision-evidence.json` from that index without turning model output into
accepted facts. Existing Visioner evidence is never overwritten.

The shortcut itself does not provide Relay Job claim/checkpoint/wait-resume
integration. It must not be invoked as a standalone substitute for Relay's
durable lifecycle until Relay has a graph-selected Action that claims the
existing Task and durably records its result.
