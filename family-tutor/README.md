# Family Tutor

Family Tutor is the Neo monorepo project surface for a parent-visible Discord tutoring workflow. Reusable tutoring/runtime behavior lives in `../skills/family-tutor/`; this project contains public project documentation and architecture only.

## Create a private/local instance

All real family configuration, learner details, Discord identifiers, and durable learner memory belong under an ignored run directory:

```bash
node ../skills/family-tutor/scripts/init-instance.mjs runs/family
# edit runs/family/config/family.config.json
node ../skills/family-tutor/scripts/doctor.mjs runs/family
node ../skills/family-tutor/scripts/service.mjs start runs/family
```

Never place real family configuration in tracked project paths. `runs/` is the execution boundary for this public monorepo project.

Each learner keeps one durable `runs/family/<child-id>/AGENTS.md`. Codex owns thread history; Family Tutor stores only the current Codex thread id in the ignored child runtime directory and never persists transcripts.

The orchestrator registers a parent-only Discord `/status` command at startup. `/status child:<name>` queries that learner's existing tutor Project/thread with the learner's `AGENTS.md` context and returns concise, privacy-filtered learning signals. `/status` queries each configured learner and combines a compact overview. Requests outside `discord.parentChannelId` are denied, and the command creates no new durable learner-state files.

Parent goals, guidance, and status questions are routed to the named child's existing persistent tutor thread. The tutor returns only privacy-filtered learning summaries and sends minimum-necessary proactive escalations for meaningful academic or serious safety/wellbeing concerns. No second parent memory or transcript store is created.
