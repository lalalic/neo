# Neo workspace rules

Neo is a public monorepo with independently executable projects, shared agents and Skills. Read [MISSION.md](MISSION.md) for identity and mission context; the mission is not authorization to spend, publish, merge or make commitments. Follow the global execution harness and discover installed Skills contextually, rather than hard-coding their paths.

## Project resolution

A project has a top-level `README.md` and `AGENTS.md`. Load this root policy, then the selected project `AGENTS.md`, and only role files relevant to the current task in `<project>/agents/`. Project-specific responsibilities and workflow rules belong in that project. Shared capabilities belong in `skills/`; project-only Skills may live in `<project>/skills/`. A project-local Skill of the same name takes precedence inside its project.

A normal project may contain `agents/`, `docs/`, `config/`, `templates/`, `scripts/` and other reusable source. Do not copy reusable Skill text into Agents or include optional platforms in every Worker Prompt. Product-specific executable structure (for example Markcut `.md` video templates), reusable configuration and media behavior belong in their owning project, not this file. Preserve one authoritative source for each setting.

Content-producing Projects that opt into `neo project run` must follow the canonical [Neo Project Run Contract](docs/neo-project-run-contract.md), declare their accepted input in project-local `project.run.json`, and retain the canonical `graph.mmd` as workflow authority.

## Canonical execution and Git boundary

`runs/` is Git-ignored and owns all execution-specific media, source uploads, prompts, intermediate artifacts, credentials, receipts, logs, reviews, render output and private mutable series state. Use `runs/<YYYY-MM-DD[-slug]>/` for a standalone run, or `runs/<series-name>/<YYYY-MM-DD[-slug]>/` for a series. Series-level `series.json`, `config/`, or `state/` may hold private state shared across dated episodes. Names like `current`, `latest`, `legacy` or bare sequence numbers are not canonical run identities.

Reusable, sanitized public series definitions may be committed under `templates/`. Never commit private media or generated run contents, and do not create tracked `episodes/`, `generated/`, `output/` or instance-specific `data/`. Projects must not depend on other projects' `runs/` directories.

**Execute production against the canonical project run tree**, never from an isolated Git worktree. Use isolated worktrees for source changes and tests, but final media production, continuation, QA, approvals and archive must all use the same persistent `runs/` evidence. Do not transfer ignored run artifacts between worktrees or claim a new checkout contains historical run state.

## Work, roles and evidence

The control plane is the private `.run/PLAN.md`, `.run/state.json` and project task handoffs when present; read them only for portfolio coordination (see [control plane](docs/control-plane.md)). The applicable Job/Task state must come from the discovered Agents Relay CLI, never internal databases, HTTP APIs or guessed records. Keep task owners, destinations, status and evidence aligned at handoffs; do not invent execution IDs, approval or completion.

Use the smallest relevant role/skill context, local command `--help`, project schemas and real artifacts. Agent roles describe responsibility; adapters provide bootstrap and execution transport. The canonical event-bus protocol governs delegated lifecycle events. Subscribe/monitor where relevant, relay concrete progress, terminal failures and resource releases. Worker implementation includes self-review → fix → re-review until review has no actionable changes; verify results as a user rather than treating successful subprocess exit as evidence.

Reuse shared Markcut media understanding and rendering capability; do not create parallel inference pipelines or use a managed Relay ChatGPT Worker as synchronous vision inference. Optional browser/platform operations use the discovered WebHelm Skill and its active session lifecycle; do not hard-code outdated CDP ports or browser implementation details.

All external posting and publishing requires explicit owner permission. Draft/preview consent is not publication consent. Paid services, private uploads, credentials, private data or cloud mutations require their owning authorization gates. Services managed by Neo.app must use their published package `@latest` launchers rather than fixed npm version strings; the existing package publication watcher handles updates. Local archive or tarball sources are not registry packages.

## Project Worker quality

- Every Neo Project with local Worker roles maintains `<project>/.evals/cases.json` and local, Git-ignored `.evals/reports/`. Run with the Neo CLI: `neo eval run --project NAME`; inspect with `neo eval list --project NAME` and audit coverage using `neo eval audit`. For model decision Cases, generate the actual Agent prompt with Relay PromptBuilder and evaluate its isolated built variant; do not concatenate static AGENTS/role text. Cases test project outcomes and decisions; deterministic executable tests (e.g. Markcut template verification) are distinct from model-graded role decisions. Generic Relay L4 bootstrap/transport PASS is not Worker quality evidence. Apply global Markdown and skill-builder rules when authoring cases.

## Learning

Capture durable project-specific lessons in the project's `AGENTS.md` and role-specific details in its Agent files. Cross-project rules alone belong here. Distill the observation and future action; keep incident logs, detailed evidence and one-off workarounds in private run records. Consult [historical agent/platform lessons](docs/agent-execution-learnings.md) only when relevant, not as automatic Worker context. Review obsolete lessons and remove contradictions.
