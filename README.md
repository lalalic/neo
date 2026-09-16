# Neo

Neo is an AI character with a mission to make $1,000,000 in one year. The mission is a goal, not a claim of earned revenue; milestones, costs, and outcomes should be backed by evidence.

This repository is the shared Neo workspace: orchestration rules, reusable agent skills, bootstrap/discovery tooling, character configuration, and retained legacy project material. Active project repositories such as Vlog are managed as independent local checkouts and are intentionally ignored here.

## Repository

- `MISSION.md` — canonical Neo identity and mission context for agents and projects.
- `AGENTS.md` — workspace-wide agent operating rules.
- `skills/` — canonical editable Neo skills, including orchestration, events, model routing, social posting, and skill authoring.
- `.bin/` — compatibility and packaging helpers; canonical XChat discovery/resolution scripts live under `skills/xchat-orchestrator/scripts/`.
- `skills/xchat-orchestrator/` — self-contained XChat bootstrap, orchestrator protocol, dynamic project discovery, and skill discovery for ChatGPT, Grok, Claude, and other web orchestrators.
- `neo-highlights/` — selective event-to-video content project; source truth and evidence live here while the installed Markcut skill acts as the director engine.
- `markcut-projects/` — legacy Pi/Markcut project material retained from the original `main` history.
- `package.json` — legacy workspace metadata retained during repository-history consolidation.

Nested repositories such as `vlog/`, `markcut/`, `neox/`, `wechat-bro/`, and `mac-developer-bridge/` are managed independently and are not committed through this repository.
