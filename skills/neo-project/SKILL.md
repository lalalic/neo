---
name: neo-project
description: Create, discover, run, or refactor a Neo Project using its own Git root, canonical Agent Graph, Agent and Artifact contracts, private Runs, quality evals, and optional lifecycle entrypoint. The authoritative Neo Project knowledge lives in this skill and its references.
---

# Neo Project

A Neo Project owns its **domain goal, independent Git repository, Agent Graph, project Agents, Artifact contracts and private Runs**. Neo Harness supplies discovery and shared capabilities; Agents Relay owns durable Job/Task dispatch, Review, Retry and Recovery. Do not duplicate Relay lifecycle or shared Skills inside a Project.

## Choose the workflow and load only its reference

| Intent | Source of truth (in this Skill) |
| --- | --- |
| Create/refactor a project, Graph, Agent, output contract, approval, revision or service lifecycle | [Project contract](references/project-contract.md) |
| Discover projects; choose `NEO_ROOT`; understand shared/project Agent and Git boundaries | [Harness integration](references/harness-integration.md) |
| Run, resume, validate `project.run.json`, select a DAG, manage private Run Git and remote permissions | [Run contract](references/run-contract.md) |
| Audit/author Worker prompts, decision cases or executable Project quality checks | [Worker evals](references/worker-evals.md); load global `skill-builder` for Skill/Agent-eval refactors |
| Try a mobile/web capability before implementing it | [Product Prototype Recipe](recipes/product-prototype.md) |
| Evaluate the Neo Project architecture Skill itself | [Capability eval cases](evals/cases.md) |

## Invariants

- One independent Git root per project, directly beneath configured `NEO_ROOT`. Every runnable project has `README.md`, `AGENTS.md`, `graph.mmd`; run-enabled projects additionally declare `project.run.json`.
- `graph.mmd` alone owns the normal Agent DAG; `agents/*.agent.md` owns project-specific roles. Do not copy Graph edges to README, Planner or Agent prose. Use the [Agency Agent Pool](../agency-agents/SKILL.md) for reusable specialist roles through thin local `extends` manifests.
- Each Stage Agent owns declared outputs, validates its own artifacts, and repairs failures before emitting completion. `contracts/*.schema.json` governs structured handoffs, but schema PASS is not human approval or automatic Relay completion.
- Store execution inputs, media, provenance, review history and private state under Git-ignored `runs/`, never in tracked source. Run-producing work stays in the canonical project directory, not a task worktree.
- Relay owns Job/Task/Review decisions and recovery. Human approval suspends/resumes the **same Task**, and Preview does not create a Git commit or establish approval. Final Review revisions affect only necessary upstream owners and invalidated consumers.
- Require explicit authority for publishing, paid generation, uploads or external commitments. Local Git completion and optional post-completion push are separate from publication consent.

## Deliver a project change

1. Resolve the canonical independent Project Git root and read that Project's `AGENTS.md`/README, then the relevant reference above. Do not infer Project identity from the Harness checkout or cwd.
2. Identify the requested durable outcome, ownership boundary and minimal affected Agent/Artifact contracts; inspect the actual CLI/parser before assuming syntax.
3. Update the **single** Graph and project-specific manifests/schemas. Reuse shared Skills/Agents; remove obsolete duplicates rather than adding parallel workflows.
4. Verify Graph parsing, manifest resolution/PromptBuilder output, Artifact schema PASS/FAIL, and a cross-stage revision/approval decision. Add real product E2E checks when changes affect user-visible behavior.
5. For a Run change, verify `neo project run --dry-run` first, then check ordinary Relay Job/Task state and delivered artifacts. For a Skill or Agent refactor, add capability-driven evals; do not claim unexecuted model tests passed.
6. Report actual validation evidence and any unverified boundaries. Preserve unrelated repository data and private Runs.

Keep Neo Project policy **here**, not as another canonical file under `docs/`, README, specs or the generic harness bootstrap. Those locations may point to this Skill but must not restate competing project contracts. The global `agents-relay` Skill remains authoritative for Relay internals and lifecycle.
