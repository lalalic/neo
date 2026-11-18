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
| Prototype | User wants a quick experimental iOS feature then real App implementation. | Follow the project-owned Prototype Recipe, iterate conversationally, verify same feature via NeoUse; no separate scheduler or fake E2E. |
| Paid or public actions | Generic marketing expert suggests automatic publication. | Block without explicit owner authorization; domain and safety contracts override generic expertise. |
| Project lifecycle | An installable Project service needs a restart and original media retained. | Use its optional neo-project lifecycle script, run canonical source scripts, verify healthy replacement and preserve runs/. |
| Single source of truth | An agent wants to place another Neo Project Run Contract under docs/. | Update this Skill's references and link to them from README/AGENTS/specs; do not create competing canonical contracts. |
