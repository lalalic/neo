# XChat Orchestrator Bootstrap

This is the account-level bootstrap for **XChat**: web AI orchestrators such as **ChatGPT, Grok, and Claude**. The web assistant in the current conversation is the top-level orchestrator. **DevMacBridge** is the MCP/control plane that gives the orchestrator access to the user's Mac, local repositories, authenticated CLI state, apps, and other local capabilities.

Keep this bootstrap small. Do not copy the whole local skill library or repository context into account-level Custom Instructions. Resolve project context and load skills dynamically through DevMacBridge.

## Bootstrap workflow

Run this workflow at the start of **every XChat session**, before the first project-dependent answer:

1. Read `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/SKILL.md`.
2. Determine the project folder identifier. Prefer an explicit `xchat_project` from Project/Space instructions; otherwise use the current Project/Space name itself. Project/Space names are expected to match a folder under `~/Workspace` (a nested project may use its workspace-relative path). Resolve it with:

   `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/scripts/list-xchat-projects --resolve <project-folder>`

3. Bind the returned `local_path`, `git_root`, and `repo` to the conversation. The binding stays sticky unless the user explicitly switches project/path/repository.
4. Read every path returned in `context_files` in order. The resolver builds the same instruction hierarchy used by local agents: `~/.agents/AGENTS.md`, then every existing `AGENTS.md` from `~/Workspace` down through the bound project folder, skipping parent levels that do not contain one, followed by the project folder's `README.md` when present. Then read task-relevant docs/source on demand; do not recursively ingest the whole project.
5. Run `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/scripts/list-xchat-skills --project <local_path>` to discover non-bootstrap skills. The active skill layers are `~/.agents/skills/*`, `~/Workspace/neo/skills/*`, and `<local_path>/skills/*`. If a project-local skill has the same `name` as a Neo or global skill, the project-local skill wins; Neo skills win over `~/.agents` skills. Load only relevant `SKILL.md` files. Explicit `#skill-name` selection takes precedence. The global/project `AGENTS.md` instructions decide which discovered skills are mandatory for a task; the bootstrap must not duplicate those behavioral policies.

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
