---
name: model-router
description: Softly consider this skill when a task, sub-agent, thread, or delegated work could benefit from a different already-configured model/provider. Dynamically discover the harness's available profiles instead of using a fixed model list, then choose among those real options based on task fit, capability, existing paid plans/credits, quota pressure, cost, latency, reliability, privacy, and continuity. Do not reroute when an existing persistent thread already has a suitable bound profile unless there is a clear reason to switch.
---

# Model Router

Use this skill to choose an execution profile from the models/providers that are actually configured and usable in the current environment.

The goal is not to maintain a universal model leaderboard. The goal is to make good use of the user's existing model resources while preserving task quality and continuity.

## Capability tree

1. discover the profiles/providers/models currently available to this harness
2. determine what capabilities and quality level the task actually needs
3. estimate resource availability, including paid plans, credits, quota pressure, and reset horizon when observable
4. rank only the discovered candidates and choose a profile
5. explain the decision in a stable structured form
6. preserve a chosen profile for persistent work unless a reroute is justified
7. fail safely when configuration, quota, or capability information is unavailable

## When to use

Consider routing when one or more of these are true:

- the work may be delegated to a sub-agent, task, leaf agent, or new execution thread;
- another configured profile may be cheaper or may use an otherwise-idle paid plan without reducing required quality;
- the current model is poorly matched to the task's capabilities, context size, tool needs, modality, latency target, or reasoning difficulty;
- the user asks to optimize model/provider usage, cost, quota, or plan utilization;
- a provider is rate-limited, unhealthy, near quota exhaustion, or otherwise unsuitable;
- the task has not yet been bound to a persistent execution thread/profile.

Do not route merely because multiple profiles exist. If the current execution context is already suitable and switching creates more overhead than benefit, continue as-is.

## 1. Discover the real candidate set

Never start from a hard-coded provider/model list.

Inspect the current harness and environment for configured profiles. Prefer harness-native configuration and commands. For Codex, this commonly includes the active Codex configuration and configured profiles; for another harness, use that harness's own configuration source.

Discovery must answer, when observable:

- profile name or stable execution identifier;
- provider;
- model;
- endpoint or provider type, without exposing secrets;
- relevant model capabilities known from configuration or trustworthy runtime metadata;
- whether the profile is currently usable;
- authentication/plan type when it can be inferred safely;
- quota/credit status when it can be queried legitimately.

Only route to discovered, usable candidates.

If the environment is inaccessible from the current agent, do not invent candidates. Return `insufficient_environment_access` and explain what the caller must provide or discover.

## 2. Determine task requirements

Classify the work by the minimum capability needed, not by brand preference.

Consider:

- task type: coding, debugging, review, architecture, research, writing, multimodal, automation, etc.;
- complexity and reasoning depth;
- context size and repository breadth;
- tool/function-calling requirements;
- vision/audio/structured-output requirements;
- latency sensitivity;
- quality or risk sensitivity;
- privacy/locality constraints;
- expected duration and token volume;
- whether continuity with an existing thread is important.

Use the weakest candidate that comfortably satisfies the task when doing so improves use of existing resources, but do not sacrifice a material quality or capability requirement merely to consume credits.

## 3. Be subscription- and quota-aware

Treat already-paid resources and expiring/available credits as real economic signals.

When observable, distinguish:

- subscription/plan capacity already paid for;
- prepaid credits or account balance;
- per-token/per-request marginal cost;
- current remaining quota;
- time until quota or plan reset;
- rate limits and temporary throttling;
- provider health/reliability.

A useful signal is quota pressure: remaining usable capacity relative to time until reset. Capacity that will reset soon can be preferred for suitable work, while a nearly exhausted resource should be preserved for tasks where it has unique value.

Do not claim a remaining quota or balance unless it was actually observed from a trustworthy local/provider source. Use `unknown` when it cannot be queried.

Unknown quota is not the same as zero quota.

## 4. Rank candidates

Apply hard gates before preferences.

Hard gates:

1. candidate is discovered and usable;
2. candidate supports required task capabilities;
3. context/tool/modality requirements fit;
4. explicit user/provider/privacy constraints are satisfied;
5. no known quota or health condition makes execution impossible.

Then rank eligible candidates using these signals:

- task fit / expected quality;
- utilization of existing paid plan or credits;
- quota pressure and reset horizon;
- marginal cost;
- latency;
- reliability/provider health;
- privacy/locality;
- startup/switching overhead;
- continuity with an existing thread/profile.

These are policy dimensions, not fixed weights. Explain the dominant reasons rather than pretending to have precision that the available data does not support.

## 5. Prefer continuity for persistent work

Once a persistent work item or execution thread has selected a suitable profile, treat that binding as sticky.

Do not reroute on every review/revision turn.

Reroute only when there is a clear reason, such as:

- the bound provider/profile is unavailable or exhausted;
- the next round requires a capability the bound model lacks;
- quality is demonstrably insufficient;
- the user explicitly requests a different profile/provider;
- the caller intentionally starts a new independent execution thread.

If a reroute occurs, report why continuity was broken.

## XChat worker preference

For XChat managed workers, rank eligible discovered candidates in this order: ChatGPT, then ZAI, then Codex GPT. This is a preference among candidates that pass the hard capability, availability, health, quota, privacy, and explicit-user-constraint gates; it is never a fallback to an undiscovered or unusable profile. The currently supported ChatGPT worker model is `gpt-5-6-sol`. Keep that model in harness configuration/discovery so future OpenAI model changes can be adopted without changing the protocol.

## 6. Return a structured decision

Prefer a compact machine-readable result such as:

```json
{
  "decision": "route",
  "profile": "<configured-profile-name>",
  "provider": "<provider-or-unknown>",
  "model": "<model-or-unknown>",
  "thinking_effort": "<configured-thinking-level-or-unknown>",
  "confidence": "high|medium|low",
  "task_class": "<short classification>",
  "resource_status": {
    "plan_or_credit": "observed|unknown",
    "quota": "healthy|pressured|near_exhausted|unknown",
    "reset_horizon": "<observed value or unknown>"
  },
  "reasons": ["<dominant reason>", "<dominant reason>"],
  "rejected": [
    {"profile": "<name>", "reason": "<hard gate or tradeoff>"}
  ],
  "sticky": true
}
```

If no switch is warranted:

```json
{
  "decision": "keep_current",
  "profile": "<current profile if known>",
  "reasons": ["switching overhead exceeds expected routing benefit"]
}
```

If discovery is not possible:

```json
{
  "decision": "insufficient_environment_access",
  "reasons": ["configured profiles cannot be inspected from this harness"]
}
```

The caller decides how to create the task/sub-agent/thread using the returned profile. This skill does not itself require a particular orchestration mechanism.

## Events

This skill owns the semantic events for model-routing decisions. Events MUST use the events-bus envelope and follow its visibility/display rules.

When a routing decision selects a model for a new agent/worker, publish a user-visible routing event before or as that worker is launched. The event MUST report the actually selected model and configured reasoning/thinking level when known. A recommended event is `model.selected`; callers should not duplicate or reinterpret this decision into a second orchestration-specific event.

Recommended user-visible message:

```text
Selected <model> · thinking <level>
```

Recommended event-specific `data`:

```json
{
  "profile": "<configured-profile-name>",
  "provider": "<provider-or-unknown>",
  "model": "<model-or-unknown>",
  "thinking_effort": "<configured-thinking-level-or-unknown>",
  "decision": "route|keep_current"
}
```

If the model or thinking level is unavailable, report `unknown`; never infer it from provider defaults or model family names. Persistent-thread reuse does not require a new routing event unless a routing decision is actually made again or the execution profile changes.

## 7. Failure and safety behavior

- Never invent provider balances, quotas, model capabilities, or configured profiles.
- Never expose API keys, tokens, or secret configuration values in the routing result.
- Do not silently fall back to an unconfigured provider.
- Do not select a weaker model when the task has a material quality/safety/capability requirement it cannot meet.
- If all eligible candidates fail, return a clear no-route decision instead of fabricating a fallback.
- Preserve explicit user model/provider instructions over automatic routing policy.

## Decision principles borrowed from mature routers

This skill intentionally adopts several proven ideas from existing routing systems while remaining a lightweight agent skill rather than an HTTP gateway:

- capability gates before cost optimization;
- policy dimensions such as quality, cost, latency, privacy, provider health, and budget;
- explainable decisions and rejected candidates;
- sticky routing/continuity where appropriate;
- benefit-gated switching so routing overhead does not dominate;
- evaluation of routing policy against representative tasks.

See `references/routing-patterns.md` for source patterns and boundaries.

## Evals

Evaluate this skill from the capability tree, not from individual paragraphs. Core cases are defined in `EVALS.md`.
