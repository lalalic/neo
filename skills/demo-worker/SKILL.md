---
name: demo-worker
description: Run a declarative, computer-use product demo while recording and returning verified UI and video evidence.
---

# Demo Worker

The Demo Worker turns a small declarative demo intent into one observable run.
It is the reusable contract for the later pilot task; defining or validating an
intent is not evidence that a demo ran.

## Capability tree

1. validate a demo intent before touching the target app;
2. inspect the environment and choose a reliable target fixture;
3. launch the target and start recording before visible interaction;
4. use Codex Computer Use for the requested scenario, preserving its normal
   confirmation and safety behavior;
5. verify the expected success state from fresh UI state;
6. stop recording, verify a playable non-empty artifact, and return structured
   evidence.

## Worker-facing contract

The worker receives JSON with exactly these intent areas:

```json
{
  "target": {"product": "Chrome", "app": "Calculator", "url": "https://example.test"},
  "scenario": {"feature": "addition", "steps": ["..." ]},
  "success": {"visible_state": "The result 4 is visible", "fresh_ui_required": true},
  "recording": {"required": true, "scope": "full_flow", "format": "mp4"},
  "evidence": {"artifact_required": true, "fields": ["target", "scenario", "success", "artifact", "computer_use", "recoveries"]}
}
```

`target.product`, `scenario.feature`, `success.visible_state`, and the two
required flags are mandatory. `success.fresh_ui_required` must remain true:
stale DOM/text or a prior assistant claim cannot prove success.

The executor may choose Calculator or a Chrome/web fixture after environment
inspection. That choice is reported in evidence; it is not guessed in the
intent and does not change the requested scenario.

## Execution and evidence gates

The staged workflow is `environment → launch → recording_started → computer_use
→ fresh_ui_verified → recording_finalized → artifact_verified → completed`.
The worker must stop with a failed/blocked result when a required stage cannot
be observed. Recording begins before interaction and covers the full visible
flow. Computer Use actions go through the normal confirmation/safety path; an
adapter must never bypass confirmation to make a demo pass.

Completion requires an evidence object containing `target`, `scenario`,
`success`, `artifact`, `computer_use`, and `recoveries`. Artifact evidence must
identify a real path, positive byte size, and positive duration when duration
is observable. A successful validation result is only a contract/evidence
check; the separate pilot task must supply real end-to-end evidence.

## Pure contract helper

Use `scripts/contract.py` for validation in tests or adapters. It has no
browser, recorder, or network dependency. The browser/recording implementation
is deliberately supplied by the executing worker so a Chrome fixture, native
Calculator, or another safe target can be selected at runtime.

```sh
python skills/demo-worker/scripts/contract.py examples/calculator.json
python -m unittest discover -s skills/demo-worker/tests -p 'test_*.py'
```

