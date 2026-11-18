# Neo Project architecture capability eval cases

Evaluate **project design decisions**, not whether an agent can recite filenames. The authoritative contracts are [Project](../references/project-contract.md), [Run](../references/run-contract.md), [Integration](../references/harness-integration.md), and [Worker Evals](../references/worker-evals.md).

| Capability | Scenario | Expected decision |
| --- | --- | --- |
| Ownership boundary | A new video Project wants its own scheduler, Task DB, retry system and media publisher. | Keep only domain Graph, Agents, output schemas and media code; use Relay for durable Tasks/Review, and shared publishing skill only with approval. |
| Project discovery | A folder under the Harness contains AGENTS.md and graph.mmd but its Git root is the Harness parent. | Do not treat it as an independent runnable Neo Project; resolve direct Git-rooted children of configured NEO_ROOT. |
| Graph source | A Planner asks for a second list of pipeline stages in AGENTS.md. | Reference the one graph.mmd; do not replicate edges or create another DAG. |
| Task creation | A Graph has four dependent Agents and a Job is created. | Create one Coordinator and dependency-ready Agent Tasks; no initial Planner or duplicate top-level Episode Task is required. |
| Approval | An Editor requires human approval of preview media. | Suspend/resume the **same** Agent Task through Relay interactive review; no new Graph node, Git commit or approval inferred from delivery receipt. |
| Artifact validation | A producer emits JSON passing schema, but MP4 playback is broken. | Treat JSON schema PASS as insufficient; validate actual media in the owning Stage before completion. |
| Minimal revisions | Final Review rejects only the voiceover with unaffected video metadata. | Revise owning Stage and truly invalidated consumers; re-review complete result, do not rerun entire Graph unconditionally. |
| Specialist reuse | Agency Agents has a generic UX role; local project needs UX-specific deliverables. | Create thin project Agent manifest with verified absolute extends, keep local name as Relay identity and project policies dominant. |
| Missing base | An inherited Agency role source cannot be read. | Fail clearly or select verified alternative; never create a broken extends path. |
| Versioning privacy | Stage reviewer asks for a private Run video preview. | Preserve media in ignored canonical Run; interactive Preview does not commit/tag. Run Git has no remote. |
| Local-only Job | Independent Project has no GitHub remote. | Allow Job creation, local Final Review, Git Merge and completion without PR; remote push is optional only after success. |
| Worker quality | Relay transport tests pass but Agent chooses wrong creative actions. | Evaluate actual PromptBuilder-backed decision cases and project-specific executable E2E; transport PASS is not role quality PASS. |
| DAG-first design | A new Project has one vague super-Agent and starts coding before defining roles and gates. | Define the outcome, responsible Agents, real dependency Graph, task handoffs, workflows, and each Stage Exit Gate first. |
| Partial scripting | One Agent spends most of its time repeatedly normalizing inputs, but still makes editorial judgments. | Automate the repeatable transform with a tested project script, retain the Agent and its semantic Exit Gate. |
| Full Shortcut promotion | A Stage has a tested script for each deterministic step and matching real acceptance evidence. | Replace LLM execution with a resolved Agent Shortcut **only after full workflow/Exit Gate equivalence**; retain the same Graph node and Task semantics. |
| Premature Shortcut | A Stage has automated extraction but requires subjective story decisions. | Keep LLM decision-making and use the script as a helper; do not claim full Shortcut replacement. |
| JEL troubleshooter pattern | Five comparable Jobs repeatedly invoke Troubleshooter for the same missing artifact. | Diagnose JEL, fix input preflight/self-repair in owning Agent/Shortcut, then compare real recovery counts and outcome quality; do not silence failures. |
| JEL bottleneck | Run history shows a serial Stage consuming most of the elapsed duration while peers are independent. | Use actual JEL Task timing/wait evidence to refine unnecessary dependencies or automate the slow Stage; never remove real gates to inflate speed. |
| Prompt Eval feedback | Relay JEL and reviewer feedback show an Agent repeatedly choosing the wrong handoff. | Add role-specific `.evals/cases.json` cases, improve the owning Agent prompt, run PromptBuilder-backed Evals, then verify on a comparable DAG Run. |
| Paid or public actions | Generic marketing expert suggests automatic publication. | Block without explicit owner authorization; domain and safety contracts override generic expertise. |
| Project lifecycle | An installable Project service needs a restart and original media retained. | Use its optional neo-project lifecycle script, run canonical source scripts, verify healthy replacement and preserve runs/. |
| Single source of truth | An agent wants to place another Neo Project Run Contract under docs/. | Update this Skill's references and link to them from README/AGENTS/specs; do not create competing canonical contracts. |
