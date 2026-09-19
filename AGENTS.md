# Working on Neo

## Monorepo project contract

Neo is a public monorepo containing multiple top-level projects plus shared skills and infrastructure.

### Project discovery

A Neo project is a top-level directory containing both `README.md` and `AGENTS.md`. Root `AGENTS.md` applies first. Then read the selected project's `AGENTS.md`. If that project has an `agents/` directory, load only the role files relevant to the current task.

### Standard project layout

```text
<project>/
├── README.md
├── AGENTS.md
├── agents/       # optional project-specific roles
├── config/       # reusable non-secret configuration
├── docs/         # reusable documentation
├── templates/    # reusable templates, including optional series templates
├── scripts/      # reusable automation
└── runs/         # every execution/series instance; ignored and never committed
```

Projects may add other durable source directories, but actual executions must stay under `runs/`.

### Universal run contract

Every Neo project supports the same two execution forms.

Standalone work:

```text
runs/<YYYY-MM-DD[-slug]>/
```

Series work:

```text
runs/<series-name>/
├── series.json          # optional private/mutable series state
├── config/              # optional private series-level configuration
├── state/               # optional private series-level state
├── <YYYY-MM-DD[-slug]>/
├── <YYYY-MM-DD[-slug]>/
└── ...
```

Use lowercase kebab-case for `<series-name>` and put the ISO date first in every actual run directory. Do not create canonical run names such as `current`, `local`, `latest`, `legacy`, or bare sequence numbers such as `001`; those are pointers/labels, not stable run identities.

Series-level directories may hold private mutable context that genuinely spans multiple runs. Generated media, episode/storyboard content, logs, reviews, receipts, and outputs for one execution belong in that execution's dated child directory.

If a project needs a reusable public definition of a series, keep it under tracked `templates/` (for example `templates/series/<name>.json`). Actual series state belongs under `runs/<series-name>/`.

### Git boundary

Git stores the reusable system. `runs/` stores actual executions and private series state. Anything produced, selected, downloaded, captured, generated, rendered, or mutated while using a project belongs in `runs/`: episodes, instantiated prompts, private/user inputs, transcripts, generated media, intermediate files, caches, reviews, logs, delivery receipts, and final outputs.

Do not create tracked top-level `episodes/`, `series/`, `generated/`, `output/`, or instance-specific `data/` directories. If a run artifact becomes reusable source, promote it deliberately after review and sanitization. Never auto-promote private/generated run content.

Because Neo is public, secrets, personal data, customer data, private identifiers, unpublished user content, and authenticated runtime state must stay in ignored `runs/` or another private store.

### Agent and skill placement

- `AGENTS.md` is the project routing/discovery entrypoint.
- Project-only roles live in `<project>/agents/<role>.md`.
- Project-only capabilities may live in `<project>/skills/<skill>/`; they are visible only when that project is the active XChat project.
- Cross-project reusable capabilities live in root `skills/<skill>/`.
- If a project-local skill and a shared/global skill declare the same skill `name`, the project-local skill takes precedence within that project.
- Do not duplicate a reusable skill as a project agent.
- A project must not depend on another project's `runs/` directory.

### Project learning contract

Every Neo project must learn from real work. After a meaningful implementation, failure, review, production run, or user correction, reflect on whether the experience produced a durable lesson that would improve future work in that project.

- Record valuable, reusable project-specific lessons in `<project>/AGENTS.md` under a `## Project learnings` section.
- Write learnings as concise dated rules or observations: what was learned and how future agents should behave differently.
- Promote only durable lessons. Do not turn `AGENTS.md` into a run diary, changelog, transcript, incident log, or list of one-off facts.
- Evidence and detailed run history remain in ignored `runs/`; the learning is the distilled reusable conclusion.
- If a lesson applies to multiple Neo projects, promote it to root `AGENTS.md` instead of duplicating it across projects.
- If a lesson is specific to one project agent role, put the detailed guidance in `agents/<role>.md` and keep only the routing-level consequence in the project `AGENTS.md` when needed.
- Update or remove an older learning when later evidence shows it is wrong or obsolete. Do not preserve contradictory folklore.
- Reflection is part of the normal workflow: `intent → implement → audit → verify → reflect → capture durable learning`.

### Runtime hygiene

Root `.gitignore` ignores `**/runs/`. Project code must write runtime artifacts there by construction rather than depending on media-extension ignores.

### Neo orchestrator control plane

At a Neo session or recovery, read `MISSION.md`, then the private top-level `.run/PLAN.md` when present, then `.run/state.json` and its task files. Review the durable plan before selecting or delegating tasks; decompose reviewed work into tasks owned by projects/workers, and feed evidence and results into later plan reviews. `.run/` is ignored and holds only the portfolio plan, current state index, per-task handoff records, and review/decision history; project execution artifacts remain in each project's `runs/`. Before and after every handoff, record task owner, project, worker/thread/profile when applicable, authoritative references, last observed state, next action, and `requires_user`. Reconcile `.run` against GitHub, events-bus, worker, and artifact state before acting; `.run` never overrides authoritative state. See `docs/control-plane.md`.

Read `MISSION.md` at the start of every Neo session and treat it as the canonical Neo identity/mission context. Identify the user's intention before implementation. Mission and plan content are not permission to spend, publish, merge, make external commitments, or claim earnings.

Use the strongest model for architecture, ambiguous decisions, and integration review. Delegate bounded implementation, extraction, and tests to cheaper models when available. Role and model profile are separate concepts. The user explicitly requests cost-conscious subagent use.

Workflow: intent → implement → audit against source contracts → verify as a user → reflect. Try an issue at most three times within one approach, then change approach or ask for help.

For delegated or background work, use the `events-bus` contract in `skills/events-bus/references/protocol.md`. The owning orchestrator must create and propagate one `job_id`, subscribe before launching sub-agents, and proactively surface user-visible milestones, blocked/failure states, resource-release events such as `phone.released`, and completion. Writing progress only to a child process log is not sufficient.

Audit sources: current user request, the accepted architecture in `vlog/docs/architecture.md`, installed Markcut/NeoX skills, local executable help, and observable artifacts. Do not replace an observable result with a successful exit code.

For browser verification use `agent-browser` connected to the user's CDP port 64086 and close only the new testing tab. Keep manual assets in `assets/`; preserve Markcut caches. Use `npx` or `uvx` for missing Node/Python applications. Any PM2-managed service must execute/restart from its package launcher (`npx` for npm/Node, `uvx` for PyPI/Python), not from a local repository checkout. Use `apply_patch` for edits.

Publishing is handled through `skills/post` when the user explicitly asks to post or publish; a prepare/preview/draft request is not publication authorization. Engagement remains deferred unless explicitly requested. Keep personal media, workflow databases, generated media, and credentials out of Git.

## Reflections

- 2026-09-19: ChatGPT thread creation must click a fresh browser chat before selecting the exact Project; the returned conversation URL is evidence, but `thread_id` remains the durable identity.

- 2026-09-11: Preserve the distinction between a durable workflow and an autonomous worker. A queued command plan is not evidence that a producer, phone trigger, or model call ran.
- 2026-09-11: Agree on the CLI/config contract before parallel implementation, and request small reviewable patches early. Bind review approval to file bytes, not just filenames or a prose report.
- 2026-09-19: Browser-backed ChatGPT workers need a pure contract layer that separates requested from observed thinking level, binds every operation to a verified Project, and treats deleted thread identities as terminal tombstones before any selector adapter is added.
