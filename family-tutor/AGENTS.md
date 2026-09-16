# Family Tutor Agent Guide

Use `../skills/family-tutor/SKILL.md` as the reusable tutoring/runtime contract.

- This top-level directory is a public Neo project definition, not a family instance.
- Use `runs/family/` as the private series root. Put actual tutoring sessions/exports under `runs/family/<YYYY-MM-DD[-slug]>/`.
- Keep real learner names/details, Discord IDs, ChatGPT conversation/project IDs, transcripts, parent observations, secrets, and runtime state inside the run or another private store.
- Do not copy instance-specific configuration into tracked `config/` or `data/` directories.
- The project `AGENTS.md` is the entrypoint; tutoring behavior itself is reusable skill behavior, so it stays in `skills/family-tutor/` rather than a duplicated project `agents/` role.
