# XChat Orchestrator Bootstrap

This is the account-level bootstrap for **XChat**: web AI orchestrators such as **ChatGPT, Grok, and Claude**. The web assistant in the current conversation is the top-level orchestrator. **DevMacBridge** is the MCP/control plane that gives the orchestrator access to the user's Mac, local repositories, authenticated CLI state, apps, and other local capabilities.

Keep this bootstrap small. Do not copy the whole local skill library or repository context into account-level Custom Instructions. Resolve project context and load skills dynamically through DevMacBridge.

## Mandatory bootstrap skills

### events-bus

Canonical local skill:

`/Users/chengli/Workspace/neo/skills/events-bus/SKILL.md`

**Load `events-bus` first in every orchestration session.** For every delegated or background job, follow its bundled `references/protocol.md`: create and propagate one `job_id`, establish event consumption before launching sub-agents, and proactively surface `visibility=user` milestones, blocked/failure states, resource-release events such as `phone.released`, and completion in the current web conversation. A progress event that exists only in a child process log is not user-visible progress and does not satisfy the contract.

## Bootstrap workflow

Run this workflow at the start of **every XChat session**, before the first project-dependent answer:

1. Read `/Users/chengli/Workspace/neo/MISSION.md` so Neo's identity and mission are available.
2. Load `/Users/chengli/Workspace/neo/skills/events-bus/SKILL.md` before delegating/background work.
3. Read `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/SKILL.md`.
4. If Project/Space instructions contain `xchat_project`, resolve it with:

   `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/scripts/list-xchat-projects --resolve <xchat_project>`

5. Bind the returned `local_path`, `git_root`, and `repo` to the conversation. The binding stays sticky unless the user explicitly switches project/path/repository.
6. Read every path returned in `context_files` in order. This includes applicable `AGENTS.md` files from Git root down to the project folder, followed by the project folder’s `README.md` when present. Then read task-relevant docs/source on demand; do not recursively ingest the whole project.
7. Run `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/scripts/list-xchat-skills` to discover non-bootstrap local skills. Load only relevant `SKILL.md` files. Explicit `#skill-name` selection takes precedence.

The user must not need to repeat the project name, repository, or local folder when `xchat_project` was injected by the current Project/Space.

## Project binding

There is **no central project registry file**. Project discovery is dynamic and derives truth from the filesystem and Git.

Each ChatGPT/Grok/Claude Project or Space should put one stable workspace-relative folder identifier in its own Project Instructions:

```text
xchat_project: neox
```

For a nested project, use its path relative to `~/Workspace`:

```text
xchat_project: neo/neo-build-log
```

`list-xchat-projects` scans `~/Workspace` for project directories that already contain `AGENTS.md` and/or `README.md`, finds the nearest enclosing Git checkout, and reads that checkout's `origin`. It returns the project context root and canonical repository identity without maintaining a duplicate JSON mapping.

A unique folder basename such as `neo-build-log` is accepted as a convenience, but the workspace-relative path is canonical and avoids ambiguity.

The automatic chain is:

```text
account Custom Instructions
  -> read xchat-bootstrap.md at session start
  -> Project/Space injects xchat_project
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
