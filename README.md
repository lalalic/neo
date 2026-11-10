# Neo

Neo is an AI character with a mission to make $1,000,000 in one year. The mission is a goal, not a claim of earned revenue; milestones, costs, and outcomes should be backed by evidence.

This repository is the public **Neo Harness source**: CLI, bootstrap/discovery tooling, shared agent definitions, and reusable Skills. Installing Neo.app prepares the Harness without requiring a source checkout. Each runnable Neo Project is an independent Git repository directly beneath the configurable `NEO_ROOT` directory.

## Repository

- `MISSION.md` — canonical Neo identity and mission context for agents and projects.
- `AGENTS.md` — workspace-wide agent operating rules.
- `skills/` — canonical editable Neo skills, including orchestration, events, model routing, social posting, and skill authoring.
- `skills/mcp-wrapper/` — orchestrate external MCP providers, Relay and the Neo.app Core review service with one-call Markcut Preview wrappers.
- `.bin/` — compatibility and packaging helpers; canonical XChat discovery/resolution scripts live under `skills/xchat-orchestrator/scripts/`.
- `neo agent list [--project PATH]` and `neo agent search QUERY [--project PATH]` — discover context-visible project and shared Agent definitions plus Agency Agents specialist templates; templates require a project manifest before Relay dispatch.
- `neo mcp token issue --stdout` (direct interactive copy) or `--output` (private file), plus `revoke` — provider-neutral, one-hour OAuth PKCE credentials; see `docs/interactive-mcp-access.md`.
- `neo gpu build|run|services|doctor|cleanup` — **built-in Node.js** GPU module: converts a project Dockerfile into a reusable image and runs it through HF Jobs or Vast.ai. See [GPU service contract](gpu/README.md). No separately installed `neo-gpu` package is needed. Images and private inputs are never bundled into the Neo CLI.
- `neo computer-use help` and `neo computer-use call COMMAND [--args-file PATH]` — **the only Neo.app MCP tool exposed via local CLI**. Calls are synchronous, bound to a fixed Computer Use subcommand allowlist, and reuse the native app permissions. Other local operations use Shell or WebHelm Skills, not generic MCP passthrough. Local Escalation uses this CLI directly; its workflow is defined in `agents/escalation.agent.md`.
- `neo escalation --handoff-file PATH` — always runs a synchronous on-demand stateless local agent + llama.cpp Metal using Qwen3.5-4B Q4. Uses WebHelm, `neo computer-use`, and Shell; stops model process after the call. A per-host exclusive lock serializes concurrent `neo escalation` requests, including the self-test (default wait 3600s). Change model/inference with `NEO_ESCALATION_MODEL` / `NEO_ESCALATION_ENGINE`. See `docs/local-escalation.md`.
- `neo escalation challenges [--search TEXT] [--limit N]` — inspect original unredacted handoffs, compact attempt outcomes and last-stage crash checkpoints on Neo Master. Stored locally in 0700/0600 directories; do not forward to public logs.
- `neo escalation cases [--search TEXT] [--limit N]` — inspect private deduplicated success/failure/human-handoff experience candidates. See `docs/escalation-experience.md`.
- `skills/xchat-orchestrator/` — self-contained XChat bootstrap, orchestrator protocol, dynamic project discovery, and skill discovery for ChatGPT, Grok, Claude, and other web orchestrators.
- `neo-build-log/` — public build-log production system; each actual episode lives under ignored `runs/`.
- `neo-highlights/` — selective event-to-video project; each highlight execution lives under ignored `runs/`.
- `drama/` — reusable AI drama production engine; series/episode/media executions live under ignored `runs/`.
- `family-tutor/` — public tutoring project surface; real family instances and learner data live under ignored `runs/`.
- `vlog/` and `content-distribution/` — independent local Git repositories on Neo Master (not owned or published by Neo Harness Git). Their media, Run histories, and local state remain under project-owned ignored `runs/`.
- `package.json` — legacy workspace metadata retained during repository-history consolidation.

Nested repositories such as `markcut/`, `neox/`, `wechat-bro/`, and `mac-developer-bridge/` are managed independently and are not committed through this repository.
For Projects enabled for `neo project run`, each project owns a `run-template/.gitignore` and explicit text-artifact allowlist. Run Git is local, nested inside ignored `runs/`, and never pushed. Git safety hooks are checked into `.githooks/`; enable them in the canonical Neo checkout with `git config core.hooksPath .githooks` (or use `npm run push`, which independently checks outgoing Run paths). See [Run Contract](docs/neo-project-run-contract.md#local-run-git-versioning).

The [Neo Harness and independent Projects design](docs/neo-harness-project-layout.md)
defines the one-root configuration, Agent/Skill/Shortcut lookup, repository
ownership and the boundary with Agents Relay. It also identifies uncompleted
release gates and historical Job migration work.

## Repository model

Neo Harness owns shared tooling. `neo project list|resolve|run` recognizes only direct children of `NEO_ROOT` whose Git root is **that project**. Legacy source-folders tracked by the Harness Git repository are not runnable Neo Projects. The default `NEO_ROOT` is `~/Workspace`; on Neo Master, `~/.config/neo/workspace.json` explicitly selects `~/Workspace/neo`, allowing `vlog/` and `content-distribution/` to keep their existing canonical Run paths. The `NEO_ROOT` environment variable overrides the saved `neoRoot` setting.

Every runnable project owns its own `.git`, `AGENTS.md`, `README.md`, `graph.mmd` DAG, and private `runs/`. Each project excludes `runs/` from source Git, while nested Run Git histories remain local and private. No GitHub remote is required. Unmigrated historic project directories may still be present in this source checkout but are not discovered by `neo project`. See [Neo Project Run Contract](docs/neo-project-run-contract.md) for execution details.
