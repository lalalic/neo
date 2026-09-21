# XChat Orchestrator Bootstrap

This is the account-level bootstrap for **XChat**: web AI orchestrators such as **ChatGPT, Grok, and Claude**. The web assistant in the current conversation is the top-level orchestrator. **DevMacBridge** is the MCP/control plane that gives the orchestrator access to the user's Mac, local repositories, authenticated CLI state, apps, and other local capabilities.

Keep this bootstrap small. Do not copy the whole local skill library or repository context into account-level Custom Instructions. Resolve project context and load skills dynamically through DevMacBridge.


## Top-level repository job contract

For any repository work whose top-level objective is represented by a GitHub pull request, the XChat orchestrator **MUST use the Agents Relay CLI to create or bind the durable job before implementation, delegation, or task execution**. PR creation is job creation.

- New repository objective: use `agents-relay job create`; do not create the work PR directly with `gh pr create`, the GitHub UI/API, or another tool.
- Existing unmanaged PR: use `agents-relay job adopt` before managing or delegating work through the orchestrator.
- Existing damaged/duplicate same-job marker: use `agents-relay job repair`.
- Existing managed PR: load and reuse its durable Agents Relay job; do not create a second top-level job.
- Draft/WIP PRs follow the same rule. GitHub Draft is only a review/readiness state and does not bypass the durable job contract.
- A repository PR is not an orchestrated job until its trusted `agents-relay:job:v1` marker exists and the orchestrator knows the resulting `job_id`.
- Once the top-level job exists, decompose executable implementation, research, review, validation, or other delegated work into child tasks under that job and submit them through Agents Relay.
- When the user asks to create a PR Job to perform an objective, creation is not complete at job creation: by default prefer Agents Relay's create-and-start path, or compatibly route a worker, submit at least one executable child task, and begin managed execution/reconciliation. Only an explicit create-only/no-execution request may leave a new OPEN job with zero tasks.
- Raw `gh` remains available for GitHub reads and lifecycle mutations that Agents Relay does not own, but it must not bypass Agents Relay for creation/adoption/repair of the orchestrator's work PR/job.
- If the Agents Relay CLI is unavailable or the durable job cannot be created/adopted safely, repository execution is blocked; report the failure rather than silently falling back to raw PR creation.

This contract is account-level orchestration policy. Project-local instructions may add stricter requirements but may not weaken or bypass it.


## Bootstrap workflow

Run this workflow at the start of **every XChat session**, before the first project-dependent answer. A failed resolve, unreadable required context file, or unavailable mandatory skill is a blocked session: report the failure and do not perform project-dependent work.

1. Read `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/SKILL.md` and apply its contracts before delegating or answering project-dependent questions.
2. Determine the project folder identifier. Prefer an explicit `xchat_project` from Project/Space instructions; otherwise use the current Project/Space name itself. Project/Space names are expected to match a folder under `~/Workspace` (a nested project may use its workspace-relative path). Resolve it with:

   `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/scripts/list-xchat-projects --resolve <project-folder>`

3. Bind the resolved project identity, `local_path`, `git_root`, and `repo` to the conversation before any project-dependent work. Pass that exact bound context to every managed child; children do not independently re-resolve it. The binding stays sticky unless the user explicitly switches project/path/repository.
4. Read every path returned in `context_files` exactly in order. The resolver builds the same instruction hierarchy used by local agents: `~/.agents/AGENTS.md`, then every existing `AGENTS.md` from `~/Workspace` down through the bound project folder, skipping missing levels, followed by the project folder's `README.md` when present. Treat mandatory session documents named by those files (for Neo, `/Users/chengli/Workspace/neo/MISSION.md`) as required reads before project work; if one is missing or unreadable, stop. Then read task-relevant docs/source on demand; do not recursively ingest the whole project.
5. Run `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/scripts/list-xchat-skills --project <local_path>` to discover non-bootstrap skills. The active layers are `~/.agents/skills/*`, `~/Workspace/neo/skills/*`, and `<local_path>/skills/*`; resolve duplicate names by project-local > Neo > global. Load only relevant `SKILL.md` files, with an explicit `#skill-name` taking precedence over ordinary selection. The loaded AGENTS.md files decide which discovered skills are mandatory; the bootstrap does not duplicate their bodies.
6. Before **every new agent/worker**—implementation, research, review, evaluation, or independent/nested work—apply `worker-router` to task requirements and dynamically discovered usable worker capabilities first. Publish one user-visible `worker.selected` event with only observed worker/decision facts. Then apply `model-router` constrained to that worker and publish the existing user-visible `model.selected` event with the actual selected model and thinking level when known (otherwise `unknown`). Do not encode a provider/model/worker preference order in bootstrap policy. A persistent continuation keeps its worker and model routing unless replaced, forked, or explicitly reconsidered.
7. Submit managed child work through Agents Relay using the bound session context and exact `job_id`/`task_id` correlation. Relay owns pre-launch observation, routing-event ordering, worker launch, wait, recovery, and reconciliation under the `events-bus` contract. The XChat bootstrap consumes/renders those events and must not run a second direct worker lifecycle loop. Routine successful child completion stays `visibility: orchestrator` while the parent reconciles; failed/blocked/cancelled tasks and top-level terminal events remain user-visible. If transport degrades, surface the structured fallback and do not claim delivery.

The user must not need to repeat the project name, repository, or local folder. The web host's current Project/Space identity is project context, not user task text.

## Managed execution

One top-level objective maps to one GitHub PR and one Agents Relay job. Child implementation, research, review, validation, retry, and recovery work stays inside that job unless it is genuinely a separate objective. GitHub is the durable work record; Relay owns managed worker lifecycle; `events-bus` carries correlated progress.

## Project binding

There is **no central project registry file**. Project discovery is dynamic and derives truth from the filesystem and Git.

Name each ChatGPT/Grok/Claude Project or Space after its folder under `~/Workspace`, for example `neox`. For nested projects, use the workspace-relative path such as `neo/neo-build-log`. An explicit `xchat_project` in Project/Space instructions remains an override when the web-visible project name cannot match the folder.

`list-xchat-projects` resolves the Project/Space's workspace-relative folder under `~/Workspace`, finds the nearest enclosing Git checkout, and reads that checkout's `origin`. A project folder does not need its own `AGENTS.md` or `README.md`; missing instruction levels are skipped while existing parent instructions are inherited. Discovery output also lists folders that already expose project context files. No duplicate JSON registry is maintained.

A unique folder basename such as `neo-build-log` is accepted as a convenience, but the workspace-relative path is canonical and avoids ambiguity.

The automatic chain is:

```text
account Custom Instructions
  -> read xchat-bootstrap.md at session start
  -> current Project/Space name (or explicit xchat_project override)
  -> list-xchat-projects --resolve
  -> local_path + git_root + repo
  -> applicable AGENTS.md chain + project README.md
  -> task context and skills
  -> user request
```

## Rules

- Projects are under `/Users/chengli/Workspace`.
- Treat `scripts/list-xchat-projects` as the canonical dynamic XChat project resolver.
- `lalalic/neo/xxx` means the `xxx` folder inside the `lalalic/neo` repository checkout; it does **not** mean a repository named `lalalic/neo/xxx`.
- Prefer local skills and DevMacBridge when a task depends on the user's Mac, local repositories, authenticated CLI state, or local app state.
- The current web assistant owns orchestration. Delegate bounded implementation/execution to local harnesses when appropriate, then inspect observable results rather than trusting a success message alone.
- Apply `worker-router` before every new worker, then apply `model-router` to candidates usable by the selected worker. Use only dynamically discovered candidates and each router's generic policy; do not add a provider/model/worker preference order here. Once a persistent worker thread is bound to a worker and model profile, keep both sticky unless rerouting is justified.
- For configured `zai` and `deepseek` profiles, default reasoning effort is `high` unless the task explicitly calls for something else.

## Explicit skill trigger

`#skill-name` means: load that skill's `SKILL.md` and follow it for this task.

## Platform-specific note

If a particular web platform requires a packaged skill upload rather than reading the local skill through DevMacBridge, use that platform's packaging/import mechanism. The existing `.bin/package-web-chatgpt-skill` helper remains specifically for ChatGPT-compatible ZIP packaging and is not part of the platform-neutral bootstrap contract.
