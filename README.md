# Neo

Neo is an AI character with a mission to make $1,000,000 in one year. The mission is a goal, not a claim of earned revenue; milestones, costs, and outcomes should be backed by evidence.

This repository is the public **Neo Harness source**: CLI, bootstrap/discovery tooling, shared agent definitions, and reusable Skills. The native bundle contains the executable and committed Harness assets without requiring a source checkout. Each runnable Neo Project is an independent Git repository directly beneath the configurable `NEO_ROOT` directory.

## Native Rust CLI

The native Rust Harness is built with `cargo build --release --locked -p neo-harness-cli --bin neo-rs`. The Neo Master deployment stages the executable and committed resources with `neo-rs package stage` in a versioned local directory. Rust is the only Harness implementation in this repository. Rollback uses a previous versioned Rust bundle. JavaScript remains only for independent workloads, container internals, Skills and test drivers; it is not a second CLI. Neo.app installer migration from its historical npm distribution is owned by the separate neox repository. See the [live-trial contract](specs/003-neo-harness-rust-port/contracts/cli-live-trial.md).

## Repository

- `MISSION.md` — canonical Neo identity and mission context for agents and projects.
- `AGENTS.md` — workspace-wide agent operating rules.
- `skills/` — canonical editable Neo skills; the [Neo Project Skill](skills/neo-project/SKILL.md) owns all Neo Project knowledge and links to its detailed reference contracts.
- **Optional iPhoneHelm Skill** — maintained and installed independently from [`lalalic/iphone-helm`](https://github.com/lalalic/iphone-helm). Neo.app's default Harness package does not ship it or the obsolete `neo-use` alias. When explicitly installed under `~/.agents/skills/iphone-helm`, existing Neo skill discovery enables it automatically; see [optional Skills](docs/optional-skills.md).
- `services/models/` — authenticated Models Gateway and Orchestrator Chat; see [Models service](services/models/README.md).
- `skills/mcp-wrapper/` — orchestrate external MCP providers, Relay and the Neo.app Core review service with one-call Markcut Preview wrappers.
- `.bin/` — compatibility and packaging helpers; canonical XChat discovery/resolution scripts live under `skills/xchat-orchestrator/scripts/`.
- `neo agent list [--project PATH]` and `neo agent search QUERY [--project PATH]` — discover context-visible project and shared Agent definitions plus Agency Agents specialist templates; templates require a project manifest before Relay dispatch.
- `neo token issue --stdout` or `--output`, plus `revoke` — one-hour OAuth PKCE credentials. The old `neo mcp token` spelling remains compatible; see `docs/interactive-mcp-access.md`.
- `neo token login|status|refresh|logout` — explicitly enrolled renewable device credentials. `neo token access --stdout` returns the current access credential only when explicitly requested, refreshing it as needed.
- `neo compute build|run|web|services|doctor|cleanup` — **native Rust** on-demand Docker module: converts a project Dockerfile into a reusable image and runs it through HF Jobs or Vast.ai. Start with the [Neo Compute Skill](skills/neo-compute/SKILL.md) and consult the [Compute service contract](compute/README.md) for details. no separate package is needed. Images and private inputs are never bundled into the Neo CLI.
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
For Projects enabled for `neo project run`, each project owns a `run-template/.gitignore` and explicit text-artifact allowlist. Run Git is local, nested inside ignored `runs/`, and never pushed. Git safety hooks are checked into `.githooks/`; enable them in the canonical Neo checkout with `git config core.hooksPath .githooks` (or use `npm run push`, which independently checks outgoing Run paths). See [Run Contract](skills/neo-project/references/run-contract.md#local-run-git-versioning).

The [Neo Harness and independent Projects integration](skills/neo-project/references/harness-integration.md)
defines the one-root configuration, Agent/Skill/Shortcut lookup, repository
ownership and the boundary with Agents Relay. It also identifies uncompleted
release gates and historical Job migration work.

## Repository model

Neo Harness owns shared tooling. `neo project list|resolve|run` recognizes only direct children of `NEO_ROOT` whose Git root is **that project**. Legacy source-folders tracked by the Harness Git repository are not runnable Neo Projects. The default `NEO_ROOT` is `~/Workspace`; on Neo Master, `~/.config/neo/workspace.json` explicitly selects `~/Workspace/neo`, allowing `vlog/` and `content-distribution/` to keep their existing canonical Run paths. The `NEO_ROOT` environment variable overrides the saved `neoRoot` setting.

Every runnable project owns its own `.git`, `AGENTS.md`, `README.md`, `graph.mmd` DAG, and private `runs/`. Each project excludes `runs/` from source Git, while nested Run Git histories remain local and private. No GitHub remote is required. Unmigrated historic project directories may still be present in this source checkout but are not discovered by `neo project`. See [Neo Project Run Contract](skills/neo-project/references/run-contract.md) for execution details.
