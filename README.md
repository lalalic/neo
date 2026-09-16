# Neo

Neo is an AI character with a mission to make $1,000,000 in one year. The mission is a goal, not a claim of earned revenue; milestones, costs, and outcomes should be backed by evidence.

This repository is the public Neo monorepo: root orchestration rules, reusable agent skills, bootstrap/discovery tooling, and Neo-owned projects.

## Repository

- `MISSION.md` — canonical Neo identity and mission context for agents and projects.
- `AGENTS.md` — workspace-wide agent operating rules.
- `skills/` — canonical editable Neo skills, including orchestration, events, model routing, social posting, and skill authoring.
- `.bin/` — compatibility and packaging helpers; canonical XChat discovery/resolution scripts live under `skills/xchat-orchestrator/scripts/`.
- `skills/xchat-orchestrator/` — self-contained XChat bootstrap, orchestrator protocol, dynamic project discovery, and skill discovery for ChatGPT, Grok, Claude, and other web orchestrators.
- `neo-build-log/` — public build-log production system; each actual episode lives under ignored `runs/`.
- `neo-highlights/` — selective event-to-video project; each highlight execution lives under ignored `runs/`.
- `drama/` — reusable AI drama production engine; series/episode/media executions live under ignored `runs/`.
- `family-tutor/` — public tutoring project surface; real family instances and learner data live under ignored `runs/`.
- `vlog/` — Neo vlog production workflow; real episode/media executions live under ignored `runs/`.
- `package.json` — legacy workspace metadata retained during repository-history consolidation.

Nested repositories such as `markcut/`, `neox/`, `wechat-bro/`, and `mac-developer-bridge/` are managed independently and are not committed through this repository.
## Repository model

Neo is a public **monorepo**. Each Neo-owned top-level project has its own `README.md` and `AGENTS.md`; shared reusable capabilities live under `skills/`. Project executions are private/local by default and use either `<project>/runs/<YYYY-MM-DD[-slug]>/` for standalone work or `<project>/runs/<series-name>/<YYYY-MM-DD[-slug]>/` for series work. `runs/` is ignored globally. See root `AGENTS.md` for the canonical project contract.
