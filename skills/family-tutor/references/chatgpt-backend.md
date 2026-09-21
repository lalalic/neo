# Codex CLI backend

Family Tutor's child identity is the exact ChatGPT Project `neo/family-tutor/<channel-name>`. The backend must bind the existing persistent thread in that Project and load only that child's `AGENTS.md`; a missing or mismatched Project is a configuration error, not a reason to create an alias or fallback mapping.

Each child has an isolated Codex thread. The runtime stores only `.codex-thread.json` below that child's ignored instance directory and resumes it with `codex exec resume`. The current `AGENTS.md` is supplied on every turn, so durable learner context survives a thread rollover without copying a transcript.

Images are downloaded into a temporary directory and passed to Codex with `--image`; temporary files are removed after the turn. Voice messages are transcribed locally before the tutor turn.

When the tutor emits `<FAMILY_TUTOR_MEMORY>...</FAMILY_TUTOR_MEMORY>` and `<FAMILY_TUTOR_ROLLOVER/>`, the runtime writes the complete durable memory first, removes the child thread binding, and the next turn starts a new Codex thread. Rollover is never based on an arbitrary turn count.
