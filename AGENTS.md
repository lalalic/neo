# Working on Neo

Identify the user's intention before implementation. Neo is an AI character pursuing $1M in one year; Vlog is the first project. The mission is not permission to spend, publish, or claim earnings.

Use the strongest model for architecture, ambiguous decisions, and integration review. Delegate bounded implementation, extraction, and tests to cheaper models when available. Role and model profile are separate concepts. The user explicitly requests cost-conscious subagent use.

Workflow: intent → implement → audit against source contracts → verify as a user → reflect. Try an issue at most three times within one approach, then change approach or ask for help.

Audit sources: current user request, the accepted architecture in `vlog/docs/architecture.md`, installed Markcut/NeoX skills, local executable help, and observable artifacts. Do not replace an observable result with a successful exit code.

For browser verification use `agent-browser` connected to the user's CDP port 64086 and close only the new testing tab. Keep manual assets in `assets/`; preserve Markcut caches. Use `npx` or `uvx` for missing Node/Python applications. Use `apply_patch` for edits.

Publishing and engagement remain deferred. Keep personal media, workflow databases, generated media, and credentials out of Git.

## Reflections

- 2026-09-11: Preserve the distinction between a durable workflow and an autonomous worker. A queued command plan is not evidence that a producer, phone trigger, or model call ran.
- 2026-09-11: Agree on the CLI/config contract before parallel implementation, and request small reviewable patches early. Bind review approval to file bytes, not just filenames or a prose report.
- 2026-09-12: Verify Bonjour discovery and the full handoff contract separately. A bridge can advertise successfully while still lacking the queue endpoints that a producer needs.
- 2026-09-12: An unattended worker must validate a narrow intent before dispatching and peek before claiming shared handoff queues. An empty date-filtered media search is a valid, auditable completion—not a reason to invent a vlog.
- 2026-09-12: Keep content projects inside the containing Neo workspace; a small Director contract plus Markcut-compatible episode Markdown is enough to start a build log without creating another repository or renderer.
