# Family Tutor

Family Tutor is the Neo monorepo project surface for a parent-visible Discord tutoring workflow. Reusable tutoring/runtime behavior lives in `../skills/family-tutor/`; this project contains public project documentation and architecture only.

## Create a private/local instance

All real family configuration, learner details, Discord identifiers, transcripts, and runtime state belong under an ignored run directory:

```bash
node ../skills/family-tutor/scripts/init-instance.mjs runs/local
# edit runs/local/config/family.config.json
node ../skills/family-tutor/scripts/doctor.mjs runs/local
node ../skills/family-tutor/scripts/service.mjs start runs/local
```

Never place real family configuration in tracked project paths. `runs/` is the execution boundary for this public monorepo project.
