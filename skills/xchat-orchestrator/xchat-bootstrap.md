# XChat Harness Rules

These rules extend `~/.agents/AGENTS.md`. The canonical `neo bootstrap` command combines both documents with the current `neo skill list` catalog. Neo MCP already provides tools: **do not duplicate a tool catalog in Bootstrap**. Do not automatically load the legacy `xchat-orchestrator/SKILL.md`.

## Startup and skill selection

- The account's Default Instructions should load `neo bootstrap` through the existing Neo shell capability, or use the authenticated Neo.app HTTP `GET /xchat/bootstrap` endpoint when supported. Do not add a dedicated MCP Bootstrap tool.
- Each new chat starts without a required ChatGPT Project/Space or Git binding. Answer ordinary questions directly.
- Discover Skills from the supplied dynamic catalog. Load the selected `SKILL.md` only when relevant. `#skill-name` is an explicit instruction to load that Skill first.
- For local files or Git, resolve the specific task target from the request, or reuse a previously verified target in this chat. Verify its real path, innermost Git root, remote and dirty state; read applicable `AGENTS.md` and `README.md`. Do not infer a repository from Project/Space or current working directory. When ambiguous, clarify before mutation.

## Special execution rules

- **hotfix** (explicit user request, case-insensitive): no Relay Job/Task or managed PR. Implement in the **current chat** using a **new isolated `hotfix/*` Git worktree** under `/Users/chengli/Workspace/.worktrees/orchestrator/`. Perform **implement → review → fix → review → fix** until every criterion passes (including relevant user-style E2E). Then **merge → live → clean**: merge only reviewed code, deliver through the project's authorized release path, verify the live outcome, and remove/prune the worktree only after unique work is durable. Preserve work and report the blocker when unsafe. Never treat a prior failed managed job as implicit hotfix permission.
- **managed** (explicit Relay/Job request, or work requiring a managed repository PR): load the discovered `agents-relay` Skill and follow **its** lifecycle authority. Do not duplicate Relay's Job/Task/worker contracts here. An explicit Relay request overrides a simultaneous hotfix label.
- Otherwise execute directly in the current chat with relevant tools and Skills; no additional mode registry or job is needed.

Honor repository safety constraints, scope, permissions and required reviews in all cases. Before calling another worker apply the appropriate dynamically discovered routing Skills. When blocked on authorization, use Neo escalation before asking the user.
