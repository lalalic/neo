---
name: worker-router
description: Choose the right execution worker or harness for a new task using deterministic capability gates, caller-provided resource facts, bounded policy, and sticky continuity. Run before model-router; never choose a model or duplicate provider usage readers.
---

# Worker Router

Use this skill to choose the execution worker for a new model-backed task. A
worker is an execution surface such as local Codex or ChatGPT web; it is not a
model, provider, or specialist role. Select the worker first, then let
`model-router` choose a model from candidates supported by that worker.

## Capability tree

1. classify the task's required worker capabilities;
2. discover the worker candidates supplied by the caller or harness;
3. apply hard capability, privacy, tool, and availability gates;
4. consume fresh resource/usage facts from the shared Agents Relay surface;
5. choose one eligible worker with bounded, explainable policy;
6. preserve a suitable existing worker binding for continuations;
7. return a structured decision and publish `worker.selected` when launching.

## When to use

Run worker routing before every new model-backed executable task, including
implementation, research, review, evaluation, and independent or nested work.
Do not reroute an existing persistent worker merely because another worker has
better current resource signals. Reroute only when the bound worker is
unavailable, no longer satisfies the task, is materially unhealthy, or the
caller explicitly asks for reconsideration.

## 1. Task requirements

Classify the minimum worker capabilities, not a preferred brand. Relevant
requirements include:

- `local_repo`: read or modify files in the current checkout;
- `iterative_tools`: repeated shell, test, browser, or other tool calls;
- `web_session`: an authenticated browser/web application session;
- `attachments`: inspect user-provided files or media available to that worker;
- `interactive_ui`: foreground UI interaction;
- `long_running`: durable progress and event reporting;
- `privacy`: local-only or explicitly approved data boundary;
- `one_shot`: a self-contained response with no local mutation;
- context, modality, latency, quality, or user/provider constraints.

Requirements are a hard contract. Do not weaken them to use an otherwise
available worker. A task may have both hard capabilities and soft preferences.

## 2. Inputs and discovery

Use only workers actually discovered by the caller or current harness. The
caller should provide a worker inventory such as:

```json
{
  "workers": [
    {
      "id": "codex",
      "capabilities": ["local_repo", "iterative_tools", "long_running"],
      "usable": true,
      "privacy": "local"
    },
    {
      "id": "chatgpt-web",
      "capabilities": ["web_session", "attachments", "interactive_ui"],
      "usable": true,
      "privacy": "remote"
    }
  ],
  "resource_facts": {
    "source": "agents-relay",
    "observed_at": "2026-01-01T00:00:00Z",
    "workers": {
      "codex": {"status": "healthy", "quota": "healthy"},
      "chatgpt-web": {"status": "healthy", "quota": "unknown"}
    }
  }
}
```

`resource_facts` is an input contract, not an implementation owned by this
skill. Consume fresh facts from the shared Agents Relay usage/resource surface;
do not add provider API readers, quota caches, schedulers, or balance polling.
Unknown is not exhausted. If facts are absent or stale, mark them `unknown`
and continue using capability and availability evidence.

## 3. Hard gates

Reject a worker before scoring it when any of these applies:

1. it was not discovered or is not usable;
2. a required capability, context, modality, tool, or interaction surface is
   missing;
3. the task's privacy or locality constraint is not satisfied;
4. an explicit user or orchestrator worker constraint is not satisfied;
5. observed health or resource state makes starting impossible.

Every rejected candidate must have a concise reason. Never select a worker
that fails a hard gate because its quota or cost is attractive.

## 4. Bounded choice policy

After hard gates, choose from the eligible set using only observable signals.
Use this precedence for the common cases, while explaining the dominant reason:

1. hard capability and explicit constraints;
2. continuity with a suitable persistent worker;
3. task fit and expected quality;
4. use of healthy, already-paid or otherwise available capacity;
5. observed quota pressure and reset horizon;
6. reliability, privacy, latency, cost, and startup overhead.

The policy is bounded: do not invent a new worker, model, provider, quota, or
fallback. If eligible workers tie and no meaningful signal separates them,
prefer the current worker, then the caller's declared default, then stable
lexicographic worker ID. This is a deterministic tie-break, not a provider
preference.

Resource pressure may move a compatible task to another eligible worker. It
must never override a hard capability or privacy requirement. A near-exhausted
worker may still be selected when it is the only eligible worker; report the
constraint and do not pretend resources are healthy.

## 5. Continuity

For a persistent task with a bound, healthy, capable worker, return
`keep_current` and the same worker. Do not switch for a small cost or quota
difference. A reroute is justified only by unavailability, capability loss,
material health/resource failure, explicit user instruction, or a new
independent execution. State why continuity was broken.

Worker routing is separate from model routing. After selecting `codex`, for
example, call `model-router` with only the usable model candidates supported by
Codex. This skill does not inspect model configuration and does not emit
`model.selected`.

## 6. Structured result

Return a compact machine-readable decision:

```json
{
  "decision": "route|keep_current|insufficient_environment_access|no_route",
  "worker": "codex",
  "task_class": "local_repo_implementation",
  "requirements": ["local_repo", "iterative_tools"],
  "confidence": "high|medium|low",
  "resource_status": {
    "source": "agents-relay|caller|unknown",
    "observed_at": "<timestamp-or-unknown>",
    "status": "healthy|pressured|near_exhausted|unknown"
  },
  "reasons": ["<dominant reason>"],
  "rejected": [
    {"worker": "chatgpt-web", "reason": "missing local_repo"}
  ],
  "sticky": true,
  "model_router_constraint": {"worker": "codex"}
}
```

For `insufficient_environment_access`, explain which worker inventory or
resource input could not be observed. For `no_route`, list the unmet hard
requirements or unusable candidates. Never return a successful route with a
synthetic worker ID.

## 7. Events

The worker router owns `worker.selected`, which follows the common events-bus
envelope. Publish exactly one event immediately before launching a newly
selected worker (or when a routing decision actually changes a persistent
worker). Use `visibility: user`, `status: running`, and a short message such as
`Selected worker Codex for local repository implementation`. Include the
structured decision in `data`; do not include secrets. Persistent continuation
reuse does not require a new event unless the worker changes or routing is
explicitly reconsidered.

Callers still own `task.started`, task terminal events, and `model.selected`.
An event publish failure must not be represented as a successful delivery; use
the events-bus fallback and report the transport problem to the orchestrator.

## 8. Failure and safety behavior

- Never invent workers, capabilities, usage, quota, reset times, or health.
- Never expose credentials or raw provider/account data.
- Never silently fall back to a different worker after a hard-gate failure.
- Preserve explicit user worker/privacy constraints unless the worker is
  unusable; explain the conflict when refusing them.
- If discovery is unavailable, return
  `insufficient_environment_access`, not a guessed default.
- If all discovered candidates fail hard gates, return `no_route`.
- A route decision is not evidence that a worker launched; the caller must
  launch it and report lifecycle/terminal events separately.

## Non-goals

This skill does not select models, providers, agent roles, threads, or prompts.
It does not implement provider usage readers, resource caches, scheduling,
launching, retries, or task completion detection.

## Evals

Evaluate the capability tree and decision boundaries in `EVALS.md`, including
hard-gate precedence, resource-aware switching, continuity, model-router
constraint propagation, and safe failure.
