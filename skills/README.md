# Neo-owned Skills

This directory contains Neo Harness's editable Skills, not a static inventory of Agent workflows. Discover the currently installed or project-scoped Skills through `neo skill list` (and inspect each matching `SKILL.md`). Avoid maintaining an outdated parallel catalog here.

**Neo Project knowledge** has one canonical entrypoint: [neo-project/SKILL.md](neo-project/SKILL.md). It owns the DAG-first development method, Stage Agent responsibilities/Tasks/Exit Gates, incremental scripting and Shortcut replacement, JEL-based bottleneck/Troubleshooter improvement, and Agent Eval prompt refinement. Domain-specific behavior stays with the actual Project; Relay lifecycle internals remain with the `agents-relay` Skill.

Edit and test canonical Skill source here; installed copies and bootstrap artifacts are distribution targets, not independent authorities.
