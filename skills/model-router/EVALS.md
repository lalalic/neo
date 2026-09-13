# Model Router capability evals

These evals test routing judgment, not provider API correctness.

## Capability matrix

1. Dynamic discovery
   - Only choose profiles found in the supplied/runtime environment.
   - Never invent a provider/model because it is generally popular.
2. Capability gating
   - Reject cheap/available profiles that cannot satisfy required modality, context, tools, or quality.
3. Existing-resource optimization
   - Prefer suitable already-paid subscription capacity or prepaid credits when quality is adequate.
4. Quota awareness
   - Distinguish observed quota from unknown quota.
   - Use reset horizon when available.
   - Do not treat unknown as exhausted.
5. Benefit-gated switching
   - Keep the current profile when switching overhead outweighs likely benefit.
6. Persistent continuity
   - Keep the profile bound to an existing persistent thread unless a reroute condition is met.
7. Safe failure
   - Return insufficient environment access or no-route instead of fabricating configuration, quota, or fallback.

## Suggested cases

### Case A — use prepaid capacity

Environment exposes `codex-default` (strong coding on a paid Codex plan), `glm-plan` (adequate coding on a paid plan with substantial quota resetting tonight), and `openrouter` (suitable with prepaid credits and no reset pressure). For ordinary medium-complexity implementation, routing may prefer `glm-plan` when it is adequate and its reset pressure is observed.

### Case B — capability beats unused quota

Reject a cheap, quota-rich profile when it lacks the required context or tool capability; choose a stronger suitable profile for a large-repository, tool-using task.

### Case C — unknown balance

When a configured DeepSeek profile has no available quota source, mark quota `unknown`, not zero, and use other signals.

### Case D — no local environment access

When no harness configuration or candidate profile is available, return `insufficient_environment_access`; do not guess a profile.

### Case E — sticky persistent task

For a healthy, capable persistent task bound to `openrouter-deepseek`, retain that binding during review rather than rerouting for quota alone.

### Case F — justified reroute

When the bound profile is rate-limited or exhausted and a discovered candidate satisfies requirements, reroute and explain why continuity broke.

### Case G — current session already good

For a short task with a suitable current model, return `keep_current` because switching overhead is not justified.

### Case H — explicit user override

Honor an explicit request for a configured profile unless it is unusable or materially incapable; state the conflict if rejected.

### Case I — secrets

Discover profile/provider/model without reproducing keys or tokens from configuration.

## Structured assertions

- `decision` is `route`, `keep_current`, `insufficient_environment_access`, or `no_route`.
- A selected profile belongs to discovered candidates.
- Rejected candidates include a reason when a hard gate fails.
- Quota is `unknown` when not observed.
- A persistent, suitable binding returns `keep_current` or the same profile.
- No secret value is reproduced.
- An explicit user override is respected or explicitly rejected with a reason.

Use qualitative grading only for whether the dominant rationale balances task fit and resource utilization.
