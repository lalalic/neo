# Child ChatGPT Project binding

Each child gets a separate ChatGPT Project. No child-specific ChatGPT Project Instructions are required.

Use the same XChat bootstrap contract as every other project:

- name the ChatGPT Project after the child's local project folder; a unique folder basename such as `sammy` or `maggie` is sufficient;
- XChat resolves that name under `~/Workspace` and loads the normal `AGENTS.md` hierarchy;
- for the current family instance that hierarchy is `~/.agents/AGENTS.md` -> `~/Workspace/neo/AGENTS.md` -> `family-tutor/AGENTS.md` -> `runs/family/<child-id>/AGENTS.md`, skipping any missing level;
- shared tutoring behavior comes from the Neo `family-tutor` skill; child-specific durable context belongs in the child's `AGENTS.md`.

The child `AGENTS.md` may contain changing facts such as current mastery, recurring misconceptions, active commitments, deadlines, interests, and exploration findings. Do not put ChatGPT conversation ids, transcripts, Discord ids, secrets, or unrelated runtime state in it.

The runtime may update the child `AGENTS.md` through the `<FAMILY_TUTOR_MEMORY>...complete Markdown...</FAMILY_TUTOR_MEMORY>` control block and strips that block before sending the visible reply to the child. `<FAMILY_TUTOR_PARENT>` and `<FAMILY_TUTOR_ROLLOVER/>` are likewise hidden runtime controls.
