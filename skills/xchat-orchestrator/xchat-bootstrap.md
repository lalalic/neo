# XChat Orchestrator Bootstrap

This is the account-level bootstrap for **XChat**: web AI orchestrators such as **ChatGPT, Grok, and Claude**. The web assistant in the current conversation is the top-level orchestrator. **DevMacBridge** is the MCP/control plane that gives the orchestrator access to the user's Mac, local repositories, authenticated CLI state, apps, and other local capabilities.

Keep this bootstrap small. Do not copy the whole local skill library or repository context into account-level Custom Instructions. Resolve project context once, bind it to the session, and load skills dynamically through DevMacBridge.

## Bootstrap workflow

Run this workflow at the start of **every XChat session**, before the first project-dependent answer. A failed resolve, unreadable required context file, or unavailable mandatory skill is a blocked session: report the failure and do not perform project-dependent work.

1. Read `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/SKILL.md` and apply its contracts before delegating or answering project-dependent questions.
2. Determine the project folder identifier. Prefer an explicit `xchat_project` from Project/Space instructions; otherwise use the current Project/Space name itself. Project/Space names are expected to match a folder under `~/Workspace` (a nested project may use its workspace-relative path). Resolve it with:

   `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/scripts/list-xchat-projects --resolve <project-folder>`

3. Bind the resolver result as one immutable session context before any project-dependent work:

   ```json
   {"project":"<project-folder>","local_path":"<resolved-path>","git_root":"<resolved-git-root>","repo":"<owner/name>"}
   ```

   Pass this same context to every managed task and executor. Do not let a child re-resolve the project or infer a different checkout. The binding stays sticky unless the user explicitly switches project/path/repository.
4. Read every path returned in `context_files` exactly in order. The resolver builds the same instruction hierarchy used by local agents: `~/.agents/AGENTS.md`, then every existing `AGENTS.md` from `~/Workspace` down through the bound project folder, skipping missing levels, followed by the project folder's `README.md` when present. Treat mandatory session documents named by those files (for Neo, `/Users/chengli/Workspace/neo/MISSION.md`) as required reads before project work; if one is missing or unreadable, stop. Then read task-relevant docs/source on demand; do not recursively ingest the whole project.
5. Run `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/scripts/list-xchat-skills --project <local_path>` to discover non-bootstrap skills. The active layers are `~/.agents/skills/*`, `~/Workspace/neo/skills/*`, and `<local_path>/skills/*`; resolve duplicate names by project-local > Neo > global. Load only relevant `SKILL.md` files, with an explicit `#skill-name` taking precedence over ordinary selection. The loaded AGENTS.md files decide which discovered skills are mandatory; the bootstrap does not duplicate their bodies.
6. For each new worker, require `model-router` to discover and gate candidates before launch. Prefer an eligible ChatGPT worker, then ZAI, then Codex GPT; this is a preference order, not permission to bypass capability, availability, explicit user constraints, quota, or health gates. The currently supported ChatGPT worker model is `gpt-5-6-sol`; treat it as discovered configuration that may change, not as a protocol constant. Publish a truthful user-visible `model.selected` event with the actual model and thinking level (or `unknown`). Persistent threads remain sticky unless replaced, forked, or explicitly reconsidered.
7. Submit each managed objective to **Agents Relay** with the bound session context. Relay owns pre-launch observation, routing-event ordering, worker launch, wait, recovery, correlation, progress, and reconciliation. The bootstrap must not duplicate those lifecycle loops. Use one literal `job_id` for the top-level objective and one task-specific `task_id` per child; every worker, including ChatGPT, publishes through `events-bus`. Keep successful child completion at `visibility: orchestrator` until the parent reconciles it; failed/blocked/cancelled tasks and top-level terminal events remain user-visible. If Relay reports transport degradation, surface the structured fallback and do not claim delivery.

The user must not need to repeat the project name, repository, or local folder. The web host's current Project/Space identity is project context, not user task text.

## Managed execution

One top-level objective maps to exactly one GitHub PR and one Agents Relay job. Child tasks, executors, reviews, and retries remain in that PR/job and inherit the bound `project`, `local_path`, `git_root`, and `repo`. Create a separate PR/job only for a genuinely separate objective. GitHub is the durable work record; Relay is the managed worker lifecycle, and `events-bus` is the correlated progress stream.

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
- Apply the `model-router` skill before every new worker. Among discovered, eligible candidates prefer ChatGPT, then ZAI, then Codex GPT; availability and capability gates always win. Once a persistent worker thread is bound to a profile, keep it sticky unless rerouting is justified.
- For configured `zai` and `deepseek` profiles, default reasoning effort is `high` unless the task explicitly calls for something else.

## Explicit skill trigger

`#skill-name` means: load that skill's `SKILL.md` and follow it for this task.

## Platform-specific note

If a particular web platform requires a packaged skill upload rather than reading the local skill through DevMacBridge, use that platform's packaging/import mechanism. The existing `.bin/package-web-chatgpt-skill` helper remains specifically for ChatGPT-compatible ZIP packaging and is not part of the platform-neutral bootstrap contract.
