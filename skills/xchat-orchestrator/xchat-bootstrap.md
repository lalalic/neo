# XChat Harness Rules

These rules extend `~/.agents/AGENTS.md`. The canonical `neo bootstrap` command combines both documents with the current `neo skill list` catalog. Neo MCP already provides tools: **do not duplicate a tool catalog in Bootstrap**. Do not automatically load the legacy `xchat-orchestrator/SKILL.md`.

**Legacy Default Instructions compatibility:** If an account instruction loaded this Markdown file directly (rather than the generated `neo bootstrap` output), immediately call `neo bootstrap` once through the existing Neo shell tool and follow its combined agent rules and live Skill catalog. Do not invoke it again when reading the generated output.

## Startup and skill selection

- The account's Default Instructions should load `neo bootstrap` through the existing Neo shell capability, or use the authenticated Neo.app HTTP `GET /xchat/bootstrap` endpoint when supported. Do not add a dedicated MCP Bootstrap tool.
- Each new chat starts without a required ChatGPT Project/Space or Git binding. Answer ordinary questions directly.
- The Bootstrap content already includes each discovered Skill's `name`, `description`, and `absolutePath` (the absolute `SKILL.md` file path). Use the supplied catalog for initial routing without another discovery call; refresh only when needed. Load the selected `SKILL.md` only when relevant. `#skill-name` is an explicit instruction to load that Skill first.
- If a needed Skill is not installed, use the available skill discovery and trusted `npx skills` workflow to evaluate a global installation; do not install unrelated Skills or bypass installation permissions.
- For Xiaohongshu (XHS) post details use the discovered `webhelm` Skill's XHS research action; use that browser Skill for ChatGPT plugins, Projects, and settings when user-authorized UI access is needed. For Roku playback, load `play-to-roku`. These are on-demand routes, not mandatory startup Skills.
- For a stuck ChatGPT turn or a long-thread handoff, discover the supported Neo ChatGPT turn/thread commands rather than assuming legacy `turnnew`/`threadnew` tools; carry forward full task context and verify the submission outcome.
- For local files or Git, resolve the specific task target from the request, or reuse a previously verified target in this chat. Verify its real path, innermost Git root, remote and dirty state; read applicable `AGENTS.md` and `README.md`. Do not infer a repository from Project/Space or current working directory. When ambiguous, clarify before mutation.

## Special execution rules

- **Privileged operations:** Normal shell commands run unprivileged. Before attempting an operation requiring root, use `neo privilege list` to discover the signed helper's approved actions; check `neo privilege status` and use `neo privilege run <approved-action>` only for an exact match. If the shell result indicates sudo authentication failure, follow that discovery route instead of retrying with passwords. If no action matches, request owner approval and a reviewed/signed helper update. Never use a general root shell or automatically elevate an unapproved command.
- **hotfix** (explicit user request, case-insensitive): no Relay Job/Task or managed PR. Implement in the **current chat** using a **new isolated `hotfix/*` Git worktree** under `/Users/chengli/Workspace/.worktrees/orchestrator/`. Perform **implement → review → fix → review → fix** until every criterion passes (including relevant user-style E2E). Then **merge → live → clean**: merge only reviewed code, deliver through the project's authorized release path, verify the live outcome, and remove/prune the worktree only after unique work is durable. Preserve work and report the blocker when unsafe. Never treat a prior failed managed job as implicit hotfix permission.
- **managed** (explicit Relay/Job request, or work requiring a managed repository PR): load the discovered `agents-relay` Skill and follow **its** lifecycle authority. Do not duplicate Relay's Job/Task/worker contracts here. An explicit Relay request overrides a simultaneous hotfix label.
- Otherwise execute directly in the current chat with relevant tools and Skills; no additional mode registry or job is needed.

Honor repository safety constraints, scope, permissions and required reviews in all cases. Before calling another worker apply the appropriate dynamically discovered routing Skills. When blocked on authorization, use Neo escalation before asking the user.

Neo.app is a native app, **not** a PM2-managed service. Do not restart the Neo MCP app for routine troubleshooting. When a task genuinely requires deployment or restart, follow the target repository's approved native install/launchd path; use `npx pm2` only for services PM2 actually owns.

Use `neo escalation` when appropriate for elevated operations within existing authorization. Escalation is not blanket approval for destructive or external actions; return `needs_user` when permission is genuinely non-delegable.
