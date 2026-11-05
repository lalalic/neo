# XChat harness parity evals

These evals grade observable behavior, not prose or transport implementation. Web ChatGPT and Codex adapters use the same normalized JSON transcript schema: each adapter converts its own tool/event capture into an ordered object with a `records` array. Records use one of these shapes:

```json
{"kind":"action","action":"resolve_project","ok":true,"project":"neo"}
{"kind":"context","path":"/Users/chengli/Workspace/neo/MISSION.md","order":4}
{"kind":"skill","name":"worker-router","precedence":"neo"}
{"kind":"skill","name":"model-router","precedence":"neo"}
{"kind":"action","action":"watch","job_id":"job-1","source":"events__watch","watch_established":true,"after_cursor":0,"buffered_event_count":0}
{"kind":"action","action":"watch","job_id":"fresh-job","source":"events__history_fresh_job","watch_established":true,"after_cursor":0,"buffered_event_count":0}
{"kind":"event","event_id":"w1","job_id":"job-1","task_id":"research-1","type":"worker.selected","status":"running","visibility":"user","data":{"worker":"codex","decision":"route"}}
{"kind":"event","event_id":"e1","job_id":"job-1","task_id":"research-1","type":"model.selected","status":"running","visibility":"user","data":{"model":"m","thinking_effort":"high","worker":"codex"}}
{"kind":"launch","task_id":"research-1","new_worker":true,"routed":true,"worker":"codex"}
{"kind":"event","event_id":"t1","job_id":"job-1","task_id":"research-1","type":"task.completed","status":"succeeded","visibility":"orchestrator"}
{"kind":"tool_call","name":"shell_job_status"}
{"kind":"event","event_id":"j1","job_id":"job-1","task_id":"root","type":"job.completed","status":"succeeded","visibility":"user"}
{"kind":"render","event_id":"e1"}
{"kind":"tool_call","name":"events__wait"}
```

The job_creation_starts_execution case requires normal PR Job creation to be followed by an executable child-task submission and worker launch; it permits zero tasks only when creation explicitly requests create-only/no-execution.

Run exactly `python3 skills/xchat-orchestrator/evals/checker.py --self-test` from the repository root for deterministic local checks, or `python3 skills/xchat-orchestrator/evals/checker.py transcript.json` for a captured Web ChatGPT or Codex transcript. The checker returns structured JSON and a non-zero exit status on failure. `spec.json` is the compact capability matrix used by the checker.

The `pre_human_escalation_gate` case audits the **recorded execution transcript** when a thread requests an owner action. For a normal operational blocker, include a same-task `{ "kind":"tool_call", "name":"neo_shell", "task_id":"...", "command":"neo escalation --handoff-file ..." }`, an authoritative `{ "kind":"action", "action":"escalation_result", "task_id":"...", "status":"needs_user", "verified":true, "user_action":"..." }`, and only then `{ "kind":"action", "action":"human_handoff", "task_id":"..." }`. A genuine nondelegable owner consent, explicit safety boundary or missing authorization may use `human_handoff.boundary` with supporting `evidence`. When Neo Shell is demonstrably unavailable, record `escalation_unavailable` with `verified:true` and a concrete `diagnostic`. Missing or failed escalation does not satisfy this gate. This is a transcript-quality **checker**, not a built-in hook that intercepts ChatGPT final messages.
