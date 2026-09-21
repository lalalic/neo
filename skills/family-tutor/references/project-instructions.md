# Child ChatGPT Project contract

Each child gets one dedicated persistent thread in the exact ChatGPT Project `neo/family-tutor/<channel-name>`, where `<channel-name>` is the Discord child channel name and child id: `#sammy` ↔ `sammy` ↔ `neo/family-tutor/sammy`.

The browser extension owns the runtime Project-ID/tab binding but must bind that canonical Project; tab order, tab title guesses, aliases, and child channel IDs are not learner-routing state.

The runtime supplies shared tutoring behavior and the child's current `AGENTS.md` on every turn. `AGENTS.md` is the only durable learner memory/instruction file. Keep durable mastery, misconceptions, commitments, deadlines, interests, parent guidance, and useful learning preferences there. Replace superseded facts instead of accumulating contradictions. Do not store transcripts, Discord ids, secrets, browser bindings, or parent-routing state in it.

The tutor may atomically replace `AGENTS.md` with `<FAMILY_TUTOR_MEMORY>...complete Markdown...</FAMILY_TUTOR_MEMORY>`. Parent-facing telemetry uses `<FAMILY_TUTOR_PARENT>...minimum necessary telemetry...</FAMILY_TUTOR_PARENT>`. Both markers are stripped from normal child-visible output.

Discord image and audio attachments are delivered to this same Project/thread. Audio prompts explicitly identify the file as a Discord speech/voice message and ask ChatGPT to transcribe/understand speech directly without judging writing grammar.
