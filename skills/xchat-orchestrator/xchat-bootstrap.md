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
- Raw `gh` remains available for GitHub reads and lifecycle mutations that Agents Relay does not own, but it must not bypass Agents Relay for creation/adoption/repair of the orchestrator's work PR/job.
- If the Agents Relay CLI is unavailable or the durable job cannot be created/adopted safely, repository execution is blocked; report the failure rather than silently falling back to raw PR creation.

This contract is account-level orchestration policy. Project-local instructions may add stricter requirements but may not weaken or bypass it.


## Bootstrap workflow

Run this workflow at the start of **every XChat session**, before the first project-dependent answer. A failed resolve, unreadable required context file, or unavailable mandatory skill is a blocked session: report the failure and do not perform project-dependent work.

1. Read `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/SKILL.md` and apply its contracts before delegating or answering project-dependent questions.
2. Determine the project folder identifier. Prefer an explicit `xchat_project` from Project/Space instructions; otherwise use the current Project/Space name itself. Project/Space names are expected to match a folder under `~/Workspace` (a nested project may use its workspace-relative path). Resolve it with:

   `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/scripts/list-xchat-projects --resolve <project-folder>`

3. Bind the returned `local_path`, `git_root`, and `repo` to the conversation before any project-dependent work. The binding stays sticky unless the user explicitly switches project/path/repository.
4. Read every path returned in `context_files` exactly in order. The resolver builds the same instruction hierarchy used by local agents: `~/.agents/AGENTS.md`, then every existing `AGENTS.md` from `~/Workspace` down through the bound project folder, skipping missing levels, followed by the project folder's `README.md` when present. Treat mandatory session documents named by those files (for Neo, `/Users/chengli/Workspace/neo/MISSION.md`) as required reads before project work; if one is missing or unreadable, stop. Then read task-relevant docs/source on demand; do not recursively ingest the whole project.
5. Run `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/scripts/list-xchat-skills --project <local_path>` to discover non-bootstrap skills. The active layers are `~/.agents/skills/*`, `~/Workspace/neo/skills/*`, and `<local_path>/skills/*`; resolve duplicate names by project-local > Neo > global. Load only relevant `SKILL.md` files, with an explicit `#skill-name` taking precedence over ordinary selection. The loaded AGENTS.md files decide which discovered skills are mandatory; the bootstrap does not duplicate their bodies.
6. Before launching **every new agent/worker**—implementation, research, review, evaluation, or independent/nested work—apply `model-router` to discovered usable candidates. Publish a user-visible `model.selected` event in the same job before/as launch, including the actual model and thinking level when known (otherwise `unknown`). A persistent continuation of an already-bound thread keeps its routing and does not reroute unless replaced, forked, or explicitly reconsidered.
7. For delegated work, establish the pre-launch watch capability before `job.started`: prefer `events__watch(job_id)`; if unavailable, only for a newly-created unique job with no prior events, use `events__history(job_id, after_cursor=0, limit=1)` and start at cursor `0` when empty. Then use this concrete order: establish cursor → route and publish/render `model.selected` → launch the worker → `events__wait(job_id, after_cursor, ...)` loop. Request routine successful child `task.completed` with `visibility: orchestrator` while the parent reconciles results; use `visibility: user` only for a meaningful standalone child milestone. Failed/blocked/cancelled task events and all top-level terminal job events remain user-visible and immediate. Never use the history fallback for an existing/resumed job with an unknown cursor, and never use a blocking wait before launch. Propagate that literal `job_id` plus a new task-specific `task_id` to every child. After a wait returns a user-visible event, render its message before any next tool call, including another wait. Continue after child `task.completed`; stop only on a top-level terminal job event or abnormal worker death. If transport fails, use the protocol's structured stdout/stderr fallback and report degraded observability; do not claim delivery.

The user must not need to repeat the project name, repository, or local folder. The web host's current Project/Space identity is project context, not user task text.

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
- Apply the `model-router` skill before creating a new delegated model job. Prefer suitable already-paid capacity when quality is equivalent. Once a persistent worker thread is bound to a profile, keep it sticky unless rerouting is justified.
- For configured `zai` and `deepseek` profiles, default reasoning effort is `high` unless the task explicitly calls for something else.

## Explicit skill trigger

`#skill-name` means: load that skill's `SKILL.md` and follow it for this task.

## Platform-specific note

If a particular web platform requires a packaged skill upload rather than reading the local skill through DevMacBridge, use that platform's packaging/import mechanism. The existing `.bin/package-web-chatgpt-skill` helper remains specifically for ChatGPT-compatible ZIP packaging and is not part of the platform-neutral bootstrap contract.
