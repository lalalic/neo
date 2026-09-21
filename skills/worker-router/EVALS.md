# Worker Router capability evals

These evals test worker-selection judgment and contract boundaries, not worker
launch or provider API correctness.

## Capability matrix

1. Requirement classification
   - Identify local repository, iterative tool, web-session, attachment,
     privacy, and one-shot requirements from the task.
2. Dynamic worker discovery
   - Select only workers present in the supplied inventory and marked usable.
3. Hard capability gates
   - Reject a worker missing a required capability, tool surface, privacy
     boundary, or context/modality requirement before considering resources.
4. Shared resource facts
   - Consume caller/Agents Relay facts; do not invent provider readers, caches,
     balances, or quotas. Unknown is not exhausted.
5. Bounded resource-aware choice
   - Shift a compatible task away from a near-exhausted worker when another
     eligible worker is healthy, but never override a hard requirement.
6. Continuity
   - Keep a suitable persistent worker bound despite a small resource or cost
     advantage elsewhere; reroute when unavailable or materially incapable.
7. Layering
   - Return a worker constraint for `model-router` and do not select a model.
8. Safe failure and observability
   - Return `insufficient_environment_access` or `no_route` rather than guess;
     emit one truthful `worker.selected` event before a new launch.

## Suggested cases

### Case A — local iterative coding

Task modifies a local repository and needs repeated tests. Codex supports
`local_repo` and `iterative_tools`; ChatGPT web does not. Select Codex even if
ChatGPT has more available quota, reject ChatGPT for the hard capability gate,
and constrain subsequent model routing to Codex-supported models.

### Case B — attachment/web one-shot

Task is a one-shot response grounded in an attachment available in an
authenticated ChatGPT web session, with no local mutation. Select ChatGPT web
when it is discovered and usable; do not require local tools merely because
Codex is available.

### Case C — resource pressure moves a compatible task

Both workers satisfy a short, non-local task. Fresh Agents Relay facts mark
Codex near exhausted and ChatGPT web healthy. Select ChatGPT web and explain
that resource pressure moved an otherwise compatible task.

### Case D — hard capability beats resource pressure

Codex is near exhausted, but the task requires local file edits and ChatGPT web
cannot access the checkout. Select Codex or return `no_route` if its observed
state makes execution impossible; never choose ChatGPT merely because it is
healthy.

### Case E — sticky continuation

A persistent task is bound to a healthy worker that still satisfies all
requirements. Return `keep_current` with the same worker even when another
worker has lower cost or more quota.

### Case F — justified reroute

The bound worker is rate-limited or no longer usable, and a discovered worker
satisfies the requirements. Return `route`, explain why continuity broke, and
set `sticky` for the new persistent binding.

### Case G — unknown resource facts

No trustworthy resource source is supplied. Mark resource status `unknown`,
use capability and availability evidence, and do not claim a balance or quota.

### Case H — no environment access

No worker inventory is observable. Return `insufficient_environment_access`
with the missing input; do not guess Codex, ChatGPT, or any other worker.

### Case I — explicit constraint

The caller explicitly requires ChatGPT web and it is usable. Honor it when its
capabilities satisfy the task; if it fails a hard requirement, reject it and
state the conflict rather than silently substituting another worker.

## Structured assertions

- A selected worker belongs to the discovered usable inventory.
- Every rejected worker has a reason.
- Hard capability and privacy gates outrank resource pressure.
- Missing resource facts are `unknown`, not zero or exhausted.
- A suitable persistent binding returns `keep_current` or the same worker.
- `model_router_constraint.worker` equals the selected worker when routing.
- Worker routing never returns a model or provider selection.
- Discovery failure and no eligible candidate use distinct safe decisions.
- `worker.selected` is emitted once before a new worker launch and contains no
  secrets.
