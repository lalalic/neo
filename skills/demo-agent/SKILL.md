---
name: demo-agent
description: Execute semantic product-demo shots and return fresh, structured runtime evidence.
---

# Demo Agent

The Demo Agent is the runtime boundary below the Execution Director. It receives
one semantic executable shot, chooses the appropriate interaction surface and
tool, navigates to the requested visual state, recovers from runtime UI drift,
and reports evidence that can be inspected by a downstream recorder/editor.

It owns the *how* of execution. It must not rewrite the story, change editorial
intent, or leak selectors, coordinates, or fixed action sequences into the
Execution Director contract.

## Runtime contract

Requests use an `execution-director-v1` shot plus runtime policy:

```json
{
  "schema_version": 1,
  "shot": { "id": "profiles", "identity": {}, "intent": {}, "required_visible_evidence": [], "success": {}, "presentation": {}, "autonomy": {} },
  "runtime": {
    "allowed_tools": ["browser-harness", "computer-use"],
    "capture_scope": "shot",
    "recording_required": true
  }
}
```

`allowed_tools` names capabilities, not a prescribed action sequence. The
agent may switch tabs/apps, refresh stale state, reopen a surface, or retry a
semantic goal only within the shot's autonomy boundary. The adapter must retain
normal Computer Use confirmation and safety behavior.

## Evidence contract

A successful result must include the target surface, semantic success result,
fresh-UI verification, screenshots or focus regions, timestamps, an action and
recovery summary, and recording evidence when recording was requested. A
failure result uses the same shape with `success.verified: false` and explains
the observable failure. A prior assistant claim, stale DOM, or contract
validation is not fresh-UI evidence.

Recorder/editor implementations are adapters. The contract requires lifecycle
and artifact facts but names no vendor or capture technology.

## Manual execution fallback

Runtime capability gaps do not invalidate the Director contracts. If the Demo
Agent cannot execute a semantic shot because the required app/surface has no
available CLI, MCP server, automation adapter, or other controllable runtime,
it must return an explicit `manual_required` execution outcome instead of
inventing automation or silently failing.

`manual_required` means the shot remains valid and should be handed to a human
operator/capture workflow. The handoff must preserve the semantic shot intent,
required visible evidence, presentation guidance, and success criteria so a
person can perform the UI actions and record the result manually.

This fallback is an execution concern only. Video Director and Execution
Director must not be rewritten to encode manual click steps, coordinates, or
tool-specific instructions merely because an automated runtime is unavailable.

Use `scripts/contract.py` for pure validation; it has no browser, recorder, or
network dependency.

```sh
python skills/demo-agent/scripts/contract.py examples/request.json
python -m pytest skills/demo-agent/tests
```
