# Neo Project recipe: DAG → Agent → Script → Shortcut

This is the canonical **development and continuous-improvement method** for Neo Projects. It governs a project's Agent responsibilities, Tasks, workflows and **Exit Gates**; it does not create a second scheduler, Task database or approval mechanism. A small manual prototype may be used as evidence within an Agent's work, but **prototype → discuss → port** is not the Project lifecycle and does not determine stage completion.

## 1. Design the DAG and stage contracts before automation

For the **actual desired outcome**, inspect real inputs, handoffs and final user-visible acceptance, then define:

1. **Agents:** one clear accountable owner for each domain decision/output, with input sources, responsibilities, expected artifacts and forbidden cross-role actions. Reuse existing Project/shared roles first.
2. **Tasks:** the durable work each Agent needs to complete. The graph uses Agent nodes and real dependencies; Relay materializes its Coordinator and Agent Tasks. Do not hand-build a parallel Task graph.
3. **Workflow:** order and parallelism in the single canonical `<project>/graph.mmd`, with each Stage Agent's internal steps in its own manifest/code. `graph.mmd` is the only source of normal-stage edges, not this document or README.
4. **Exit Gate:** observable, role-specific acceptance criteria at **each stage**: required artifacts, provenance, semantic quality, applicable automated checks, downstream-readiness, and mandatory human approvals. The owning Agent must self-review, repair and recheck its own output before `task.completed`; if unable, report the real failure. A schema-valid document or successful process exit alone is not a PASS.

Do not optimize or replace an undefined role: first make its responsibility, boundary, handoff and Exit Gate explicit. Validate the graph with the current Relay parser and verify a real run against its artifacts. Do not add new Review/Approval DAG nodes solely for an Agent's own gate: Relay handles the same Task's interactive suspension and resume.

## 2. Make the Agent faster with scripts, without changing ownership

Begin with an Agent making the genuinely semantic decisions. Observe its recurring steps and use **project-local scripts** for bounded, repeatable actions (input normalization, media inspection, deterministic generation/transforms, validation, reporting, transport). Keep the Agent accountable for decisions and the Exit Gate while scripts are partial helpers.

- Every script has explicit inputs/outputs, reproducible behavior, errors, and tests on real/synthetic fixtures.
- A script's success is not the Agent's success. Compare artifacts and Exit Gate outcomes before and after scripting.
- Avoid redoing reasoning in a script, forcing models for deterministic work, or requiring a model to infer facts already known by configuration.
- Keep source under the owning Project's `lib/` or `scripts/`; execution-specific inputs/results remain in ignored `runs/`.

## 3. Replace the LLM execution with a Shortcut when it is fully executable

When the complete Stage workflow, including its decisions and **Exit Gate**, can be implemented deterministically, move it to the Agent's resolved `agents/.shortcut/<agent>.agent.mjs` (according to the current Relay Shortcut resolution contract). The **same Agent name and the same DAG node** remain: only its executor changes from model-backed execution to the verified Shortcut.

Require equivalence before replacement: identical input/output and artifact contracts, truthful lifecycle/terminal events, error/recovery behavior, approvals when required, and end-to-end Exit Gate verification. Compare representative real Runs, not just unit fixtures. If semantic judgment is still required, retain the LLM Agent for that part and use scripts for the rest; **do not claim a Shortcut fully replaced the model prematurely**. Do not invent a different scheduler or extra Agent to perform the replacement.

## 4. Inspect JEL evidence after each relevant Run

Use the authoritative **Agents Relay Job Execution Lifecycle (JEL)** and supported CLI to inspect Job/Task history and actual execution evidence: graph dispatch, Task durations, wait times, retries, failed gates, recovery/ Troubleshooter frequency, review loops and delivered artifacts. The Relay Skill owns CLI syntax and recovery semantics; do not query internal databases, fabricate events or equate a terminal status with outcome success.

Classify recurring issues and make the **smallest owning-layer fix**:

| JEL evidence | Improve at the owning layer |
| --- | --- |
| Same input/contract misunderstanding across runs | Agent responsibilities, handoff and Prompt; add a focused Eval |
| Repeated mechanical work or fragile ad hoc CLI steps | Tested script, then Shortcut if the whole stage is deterministic |
| Frequent Troubleshooter dispatch for predictable failures | Preflight checks, actionable errors and self-repair **within the owning Agent/Shortcut Exit Gate**; retain Relay recovery for genuine exceptions |
| Long waits, serial bottleneck or repeated unnecessary work | DAG dependencies, parallelism, task boundaries and artifact reuse, without weakening required gates |
| Repeated false PASS, poor output, or approval loops | Stronger output evidence, quality criteria, reviewer feedback and targeted Agent Evals |

Measure **before/after** on comparable actual Runs: time per stage and total runtime, queue/wait, retry/recovery count, Troubleshooter invocations, review/rework loops and **Exit Gate quality**. Speed is not an improvement if artifacts or approval correctness regress. Fix the root cause; do not suppress exceptions or disable Troubleshooter just to improve metrics.

## 5. Use Agent Evals to improve prompts and decisions

Turn concrete JEL failures, poor decisions and review feedback into project-local `.evals/cases.json` cases: positive, negative and adversarial scenarios with expected decisions and observable acceptance checks. Run the existing Neo Eval/Relay PromptBuilder mechanism (see [Worker Evals](../references/worker-evals.md)), inspect actual prompts and decisions, refine **only the owning Agent's prompt/contract**, and rerun the relevant cases. Keep deterministic script/Shortcut tests and product E2E separate from model decision grading.

For each iteration: **JEL diagnosis → focused change (Graph/contract/Prompt/script/Shortcut) → Agent Evals + script tests → comparable real DAG Run → JEL readback → repeat**. Keep the gate and authorization policy stable unless the owner explicitly changes requirements. Record durable behavioral lessons in the owning Project Agent/AGENTS, not as duplicate global Project contracts.

## Outcome for a mature Project

A simple, understandable DAG; well-bounded Agents; explicit evidence-based Exit Gates; as much deterministic work as practical in tested scripts/Shortcuts; fewer avoidable Troubleshooter/retry cycles; reduced bottlenecks; and continuously improving prompts for decisions that still need an LLM.
