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

The orchestrator registers a parent-only Discord `/status` command at startup. `/status child-channel:<configured channel>` queries that learner's existing tutor Project/thread with the learner's `AGENTS.md` context and returns concise, privacy-filtered learning signals. `/status` queries each configured learner and combines a compact overview. Parent messages use the exact configured child Discord channel mention as their routing key, e.g. `#sammy how is the recent status?`; names, browser tabs, tab titles, and tab order are not used for resolution. Requests outside `discord.parentChannelId` are denied, and the command creates no new durable learner-state files.

Parent goals, guidance, and status questions are routed by configured child channel mention to the child's existing persistent tutor thread. In the configured parent channel, an authorized parent can write natural language with exactly one configured child channel mention anywhere in the sentence, such as `please have <#123456789> review fractions tonight`; the Discord channel ID is the deterministic routing key and the surrounding sentence remains the parent context. The tutor returns only privacy-filtered learning summaries and sends minimum-necessary proactive escalations for meaningful academic or serious safety/wellbeing concerns. No second parent memory or transcript store is created.
