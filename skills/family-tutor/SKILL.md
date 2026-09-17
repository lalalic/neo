---
name: family-tutor
description: Create and operate a persistent AI tutor for one or more children using Codex CLI threads, with Discord child channels, parent observation/control, separate child context, and a managed tutor-bridge service.
---

# family-tutor

## What this skill enables

Create a family tutoring system in which each child has an independent persistent Codex CLI thread, rotating threads, and one local durable `AGENTS.md`. Parents can observe useful learning signals and set goals through Discord, and a long-running bridge connects Discord to Codex.

Capability tree:

1. initialize a family-tutor instance;
2. create one independent persistent Codex thread per child;
3. route Discord messages deterministically to the correct child and current Codex thread;
4. apply tutoring behavior that teaches rather than simply answers;
5. provide parent observation and control without indiscriminate transcript mirroring;
6. install, inspect, restart, and diagnose the tutor-bridge service;
7. rotate overly long/noisy Codex threads while preserving continuity through local `AGENTS.md`;
8. keep provider/channel adapters replaceable.

## Primary workflow

1. Create an instance from `templates/` or use `scripts/init-instance.mjs`.
2. Configure children, Discord channel ids, and the parent channel. Set `codex.backend` to `codex`.
3. Run `scripts/doctor.mjs <instance-dir>` before service installation.
4. Ensure the host can run the authenticated `codex` CLI. The runtime persists only each child's thread id under the ignored instance directory; it never persists transcripts.
5. Install/start the bridge with `scripts/service.mjs start <instance-dir>`.
6. Verify the real Discord path, not only backend health: send distinct probe messages from each child channel, confirm each reaches that child's Codex thread, and confirm the expected reply returns to the same Discord channel without cross-child leakage. When there are multiple children, test them close together so one stalled tutor cannot silently block another.
7. Verify the parent learning channel receives a concise learning event, not the raw transcript by default.

## Tutor behavior contract

Read `references/tutoring-behavior.md` when creating or repairing tutor behavior.

- Teach before giving the final answer when pedagogically useful.
- Diagnose existing understanding and prefer hints or guided questions.
- Ask one focused question at a time when interactive teaching is appropriate.
- Use age/grade-appropriate language.
- Verify understanding with demonstrated evidence rather than accepting “I understand” as mastery.
- Keep each child's context separate.

## Parent observation contract

Read `references/parent-observation.md` when configuring the parent channel or reports. Default parent output is learning telemetry: topic, evidence, misconception, progress, next step, and tutor note. Do not mirror every child message into the parent channel by default.

## Codex, memory, and thread contract

- Each child MUST have a separate persistent Codex thread. Stable tutoring behavior, privacy rules, learner identity, parent telemetry format, durable-memory protocol, and thread-rollover policy are supplied by the runtime and skill contract.
- Local durable learner context lives at `<instance-dir>/<child-id>/AGENTS.md`; private thread state is `<instance-dir>/<child-id>/.codex-thread.json`. Do not create local transcript/session folders.
- The bridge prepends the current `AGENTS.md` to each turn. The tutor may replace it by emitting `<FAMILY_TUTOR_MEMORY>...complete Markdown...</FAMILY_TUTOR_MEMORY>`; the bridge strips the block from the child response and atomically writes the replacement.
- When the current Codex thread has become genuinely too long or noisy for effective tutoring, the tutor first captures any durable facts in the memory block, then emits `<FAMILY_TUTOR_ROLLOVER/>`. The bridge strips the marker, clears that child's thread binding, and starts a fresh thread on the next turn. Do not rollover merely because the subject changed or after an arbitrary turn count.

See `references/project-instructions.md` for the child Codex thread contract.

## Runtime boundary

The bundled `runtime/tutor-bridge` is part of this skill. It owns deterministic transport and lifecycle only: Discord connection, routing, serialized per-child queues, child Codex thread binding, durable-memory handoff, thread rollover, retries/failure reporting, parent transport, and service lifecycle.

Tutoring intelligence belongs in the Codex tutor thread and this skill contract, not in a second local LLM or OpenAI API adapter.

The backend is the local Codex CLI. See `references/chatgpt-backend.md`.

## Service lifecycle

Use the existing `daemon-service-manage` conventions:

```bash
node scripts/service.mjs status <instance-dir>
node scripts/service.mjs start <instance-dir>
node scripts/service.mjs restart <instance-dir>
node scripts/service.mjs logs <instance-dir>
node scripts/service.mjs stop <instance-dir>
```

## Safety and privacy

- Never commit Discord tokens, Codex credentials, child transcripts, or runtime state.
- A child channel must map to exactly one child.
- A tutor thread must map to exactly one child.
- Parent control commands must come only from the configured parent control channel.
- Treat child personal data as private runtime data.
