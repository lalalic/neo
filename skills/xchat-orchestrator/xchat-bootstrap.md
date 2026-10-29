# XChat Orchestrator Bootstrap

This is the account-level bootstrap for **XChat**: web AI orchestrators such as **ChatGPT, Grok, and Claude**. The web assistant in the current conversation is the top-level orchestrator. **NeoY** is the MCP/control plane that gives the orchestrator access to the user's Mac, local repositories, authenticated CLI state, apps, and other local capabilities.

Keep this bootstrap small. Do not copy the whole local skill library or repository context into account-level Custom Instructions. Resolve project context and load skills dynamically through NeoY.


## Execution mode selection

Select execution mode **before creating a Relay Job**:

- **HOTFIX:** When the user explicitly labels the current repository task `hotfix` (case-insensitive, not an incidental quotation), execute directly in **this XChat thread**. Do **not** create/adopt/repair an Agents Relay Job/Task or a managed PR. Use a new isolated `hotfix/*` worktree, repeat `implement → review → fix → review → fix` until all acceptance criteria pass, then `merge → live → clean`. Keep unique work if blocked. See [SKILL.md](SKILL.md#direct-chat-hotfix-protocol) for implementation, validation, delivery and cleanup details.
- **MANAGED:** Otherwise use Agents Relay for repository objectives represented by GitHub PRs. Create or bind the durable Job **before implementation** and submit child execution through Relay; see [SKILL.md](SKILL.md#operating-invariants). Failure to create or bind a managed Job blocks that mode; never silently switch to HOTFIX. An explicit request to use Relay overrides a simultaneous `hotfix` label.

HOTFIX bypasses only Relay/managed-PR lifecycle, not project instructions, tests, safety, permissions, branch protection or necessary approvals.


## Bootstrap workflow

Run this workflow at the start of **every XChat session**, before the first project-dependent answer. A failed resolve, unreadable required context file, or unavailable mandatory skill is a blocked session: report the failure and do not perform project-dependent work.

1. Read `/Users/chengli/Workspace/neo/skills/xchat-orchestrator/SKILL.md` and apply its contracts before delegating or answering project-dependent questions.
2. **Normal managed mode only:** read `/Users/chengli/Workspace/agents-relay/skills/agents-relay/contracts/task-job-contract.md` before starting a Relay Job/Task. HOTFIX does not depend on Relay contract availability.
3. **Normal managed mode only:** read `/Users/chengli/Workspace/agents-relay/skills/agents-relay/contracts/orchestrator-workflows.md` before executing P0/self-job work. HOTFIX skips this Relay-only prerequisite.
4. Determine the project folder identifier. Prefer an explicit `xchat_project` from Project/Space instructions; otherwise use the current Project/Space name itself. Project/Space names are expected to match a folder under `~/Workspace` (a nested project may use its workspace-relative path). Resolve it with:

   `neo project resolve <project-folder>`

5. Bind the resolved project identity, `local_path`, `git_root`, and `repo` to the conversation before any project-dependent work. Pass that exact bound context to every managed child; children do not independently re-resolve it. The binding stays sticky unless the user explicitly switches project/path/repository.
6. Read every path returned in `context_files` exactly in order. The resolver builds the same instruction hierarchy used by local agents: `~/.agents/AGENTS.md`, then every existing `AGENTS.md` from `~/Workspace` down through the bound project folder, skipping missing levels, followed by the project folder's `README.md` when present. Treat mandatory session documents named by those files (for Neo, `/Users/chengli/Workspace/neo/MISSION.md`) as required reads before project work; if one is missing or unreadable, stop. Then read task-relevant docs/source on demand; do not recursively ingest the whole project.
7. Run `neo skill list --project <local_path>` to discover non-bootstrap skills. The active layers are `~/.agents/skills/*`, `~/Workspace/neo/skills/*`, and `<local_path>/skills/*`; resolve duplicate names by project-local > Neo > global. Load only relevant `SKILL.md` files, with an explicit `#skill-name` taking precedence over ordinary selection. The loaded AGENTS.md files decide which discovered skills are mandatory; the bootstrap does not duplicate their bodies.
8. Before launching a **new worker**, follow the ordered worker-router → model-router and event requirements in [SKILL.md](SKILL.md#mandatory-routing-invariant). Direct self-work in HOTFIX mode does not launch a worker.
9. **MANAGED mode only:** submit child Tasks through Relay with the bound project and exact job/task IDs. Relay owns lifecycle and events; XChat does not run a competing worker loop. **HOTFIX** follows the direct-chat protocol instead.

The user must not need to repeat the project name, repository, or local folder. The web host's current Project/Space identity is project context, not user task text.

## Managed execution

For normal managed work, one top-level objective maps to one GitHub PR and one Agents Relay job. Child implementation, research, review, validation, retry, and recovery work stays inside that job unless it is genuinely a separate objective. GitHub is the durable work record; Relay owns managed worker lifecycle; `events-bus` carries correlated progress. The direct-chat HOTFIX lifecycle above is independent of this Job/PR mapping.

## Project binding

There is **no central project registry file**. Project discovery is dynamic and derives truth from the filesystem and Git.

Name each ChatGPT/Grok/Claude Project or Space after its folder under `~/Workspace`, for example `neox`. For nested projects, use the workspace-relative path such as `neo/neo-build-log`. An explicit `xchat_project` in Project/Space instructions remains an override when the web-visible project name cannot match the folder.

`neo project resolve` resolves the Project/Space's workspace-relative folder under `~/Workspace`, finds the nearest enclosing Git checkout, and reads that checkout's `origin`. A project folder does not need its own `AGENTS.md` or `README.md`; missing instruction levels are skipped while existing parent instructions are inherited. Discovery output also lists folders that already expose project context files. No duplicate JSON registry is maintained.

A unique folder basename such as `neo-build-log` is accepted as a convenience, but the workspace-relative path is canonical and avoids ambiguity.

The automatic chain is:

```text
account Custom Instructions
  -> read xchat-bootstrap.md and select HOTFIX / MANAGED
  -> read SKILL.md
  -> [MANAGED only] read Agents Relay task/job + orchestrator workflow contracts
  -> current Project/Space name (or explicit xchat_project override)
  -> neo project resolve
  -> local_path + git_root + repo
  -> applicable AGENTS.md chain + project README.md
  -> task context and skills
  -> user request
```

## Rules

- Projects are under `/Users/chengli/Workspace`.
- The only allowed workspace root for temporary Git worktrees is `/Users/chengli/Workspace/.worktrees/`. Never create or use `/Users/chengli/Workspace/.xchat-worktrees` (or any `.xchat-worktree*` variant). Agents Relay uses `.worktrees/agents-relay/`; orchestrator-owned temporary worktrees use `.worktrees/orchestrator/`.
- Temporary worktrees are task state, not project structure. After the owning work is merged/completed, verify there is no unique or uncommitted work, remove the worktree through Git, and prune stale worktree metadata.
- Treat `neo project resolve` as the canonical dynamic XChat project resolver.
- `lalalic/neo/xxx` means the `xxx` folder inside the `lalalic/neo` repository checkout; it does **not** mean a repository named `lalalic/neo/xxx`.
- Prefer local skills and NeoY when a task depends on the user's Mac, local repositories, authenticated CLI state, or local app state.
- When XChat reaches an execution/permission boundary that appears to require the user, invoke `neo escalation` before asking the user directly. Give it the intent, blocker, relevant context, and optionally an `--on-needs-user`/`--on-needs-user-file` instruction describing how to notify the user if escalation proves the remaining action is genuinely non-delegable. Without an override, Neo supplies the default notification instruction: prefer WeChat-bro to File Helper, then fall back to iMessage to the user themself. This only defines notification after `needs_user`; it does not change the classification threshold. `neo escalation` runs the dedicated local escalation agent with elevated Codex permissions; treat `resolved` as evidence to continue, `failed` as a technical recovery result, and only `needs_user` as justification for asking or waiting on the human.
- The current web assistant owns orchestration. Delegate bounded implementation/execution to local harnesses when appropriate, then inspect observable results rather than trusting a success message alone.
- **Never create an `adapter: orchestrator` Task as a handoff.** It is synchronous self-work owned by the exact orchestrator turn that creates it: the creator must execute and terminalize that same Task before ending the turn. Work intended for a later turn or asynchronous pickup must use a real worker adapter instead.
- Apply `worker-router` before every new worker, then apply `model-router` to candidates usable by the selected worker. Use only dynamically discovered candidates and each router's generic policy; do not add a provider/model/worker preference order here. Once a persistent worker thread is bound to a worker and model profile, keep both sticky unless rerouting is justified.
- For configured `zai` and `deepseek` profiles, default reasoning effort is `high` unless the task explicitly calls for something else.

## Explicit skill trigger

`#skill-name` means: load that skill's `SKILL.md` and follow it for this task.

## Platform-specific note

If a particular web platform requires a packaged skill upload rather than reading the local skill through NeoY, use that platform's packaging/import mechanism. Use `neo skill package SKILL_DIR OUTPUT.zip` for ChatGPT-compatible ZIP packaging and is not part of the platform-neutral bootstrap contract.


## CLI migration compatibility

The installed `neo` CLI is the sole public project and skill discovery interface. Agents must not invoke internal script files. Do not require `/Users/chengli/Workspace/neo` for a distributed CLI installation.
