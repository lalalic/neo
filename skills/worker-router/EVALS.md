# Worker Router capability evals

These evals test worker selection judgment, not provider/model selection or
Agents Relay usage-reader correctness. The worker router chooses an execution
worker first; a later model-router call may choose a model only from the
selected worker's usable candidates.

## Capability matrix

1. Task-shape classification
   - Identify the task's required worker capabilities before comparing
     resource, cost, or continuity signals.
   - Distinguish local-repository/tool-using work, attachment or web-only
     work, and tasks that need neither special surface.
2. Hard capability gates
   - Reject a worker that cannot access a required surface, modality, tool, or
     context even when that worker has better remaining quota or lower cost.
   - A hard requirement always outranks resource pressure and preference
     signals.
3. Resource-aware preference
   - For compatible workers, use fresh resource/usage facts supplied by the
     shared Agents Relay surface when available.
   - Near-exhausted Codex capacity may move an otherwise compatible task to
     ChatGPT; unknown usage is not exhaustion.
4. Bounded worker choice
   - Select exactly one discovered, usable worker for a new executable task,
     or return an explicit no-route/insufficient-access decision.
   - Do not invent workers, providers, usage values, or fallback capabilities.
5. Continuity
   - Keep a suitable worker bound to a persistent task unless it is unusable,
     lacks a newly required capability, is exhausted, or the user asks to
     switch.
6. Model-router handoff
   - The result names the selected worker and constrains the subsequent
     model-router candidate set to that worker.
   - Worker-router does not select a model or duplicate provider usage
     readers.

## Suggested cases

### Case A — local iterative coding favors Codex

The task requires repeated edits and tests in a local repository. Discovered
Codex and ChatGPT workers both satisfy the surface requirements; Codex has
healthy observed capacity. Select Codex and pass only Codex's discovered model
candidates to model-router.

### Case B — attachment/ChatGPT-web one-shot favors ChatGPT

The task is a one-shot question over a user attachment available in the web
ChatGPT surface, with no local checkout or shell access required. ChatGPT is
capable and Codex cannot access the attachment surface. Select ChatGPT. The
decision must cite the required attachment/web capability, not an assumed
provider preference.

### Case C — near-exhausted Codex shifts a compatible task

The task can run on either worker and needs no worker-specific capability.
Fresh Agents Relay usage facts mark Codex near exhausted and ChatGPT healthy.
Select ChatGPT, explain the resource-pressure tradeoff, and retain both
workers' capability facts in the decision as appropriate. Do not treat an
unobserved Codex balance as near exhausted.

### Case D — hard requirement overrides resource pressure

The task requires local filesystem and shell access. Codex is near exhausted
but still usable; ChatGPT has abundant capacity but no local tool surface.
Select Codex or return no-route if Codex is actually unusable. Never select
ChatGPT solely because its resource status is better.

### Case E — selected worker constrains model-router

Worker-router selects ChatGPT for an attachment task. The environment exposes
models under both Codex and ChatGPT. The handoff to model-router contains only
the ChatGPT candidates (or an equivalent worker binding), and the final model
decision cannot select a Codex model. A worker selection event is emitted
before the worker/model execution starts when the orchestration contract
requires observability.

### Case F — continuity beats a marginal switch

A persistent task is already bound to a healthy, capable Codex worker. A new
review turn has the same requirements and no material resource or health
change. Return `keep_current` or the same Codex binding; do not switch merely
because ChatGPT is also available.

### Case G — safe failure and unknown usage

No worker inventory is discoverable, or all workers fail a hard gate. Return
`insufficient_environment_access` or `no_route` with a concrete reason.
When the shared usage surface has no fact for a worker, report usage as
`unknown`, never as zero or exhausted, and do not fabricate a fallback.

## Structured assertions

- `decision` is `route`, `keep_current`, `insufficient_environment_access`,
  or `no_route`.
- A selected worker belongs to the discovered usable worker inventory.
- Required capabilities and rejected hard-gate candidates are represented in
  the rationale or structured rejection fields.
- Resource facts identify their source and freshness when observable; unknown
  usage remains `unknown`.
- A near-exhausted resource may influence a compatible task but never defeats
  a hard capability requirement.
- Persistent, suitable work keeps the existing worker binding.
- The model-router handoff is explicitly constrained to the selected worker;
  worker-router does not emit a model choice.
- No secret, credential, cookie, token, or invented usage/provider value is
  reproduced.

Use qualitative grading for whether the dominant rationale applies hard gates
before resource preferences and whether the handoff preserves the selected
worker boundary.
