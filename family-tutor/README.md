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

Each learner keeps one durable `runs/family/<channel-name>/AGENTS.md`. The Discord child channel name is canonical: `#sammy` maps directly to child id `sammy` and ChatGPT Project `neo/family-tutor/sammy`; no alias or channel-ID mapping is maintained. Codex owns thread history; Family Tutor stores only the current child thread id in the ignored child runtime directory and never persists transcripts.

The orchestrator registers a parent-only Discord `/status` command at startup. `/status child-channel:<configured channel>` derives the child id from that channel's exact name and queries `neo/family-tutor/<channel-name>` plus that learner's existing thread and `AGENTS.md`. A missing or mismatched Project is a configuration error. `/status` queries each configured learner and combines a compact overview. Parent messages use the exact configured child Discord channel mention as their routing key, e.g. `#sammy how is the recent status?`; names, browser tabs, tab titles, and tab order are not used for resolution. Requests outside `discord.parentChannelId` are denied, and the command creates no new durable learner-state files.

Parent goals, guidance, and status questions are routed by one Discord channel mention anywhere in the sentence. The runtime resolves that mention to the actual channel name, derives the child id and exact Project from the name, and uses the child's existing persistent thread and `AGENTS.md`. The tutor returns only privacy-filtered learning summaries and sends minimum-necessary proactive escalations for meaningful academic or serious safety/wellbeing concerns. No second parent memory or transcript store is created.
