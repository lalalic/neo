---
name: family-tutor
description: Create and operate a persistent AI tutor for one or more children using ChatGPT subscription-backed conversations, with Discord child channels, parent observation/control, separate child context, and a managed tutor-bridge service.
---

# family-tutor

## What this skill enables

Create a family tutoring system in which each child has an independent persistent tutor conversation, parents can observe useful learning signals and set goals through Discord, and a long-running bridge connects Discord to ChatGPT without requiring OpenAI API billing.

Capability tree:

1. initialize a family-tutor instance;
2. create/bind one persistent ChatGPT tutor conversation per child;
3. route Discord messages deterministically to the correct child tutor;
4. apply tutoring behavior that teaches rather than simply answers;
5. provide parent observation and control without indiscriminate transcript mirroring;
6. install, inspect, restart, and diagnose the tutor-bridge service;
7. keep provider/channel adapters replaceable.

## Primary workflow

1. Create an instance from `templates/` or use `scripts/init-instance.mjs`.
2. Configure children, Discord channel ids, the parent channel, and the ChatGPT Project id.
3. Run `scripts/doctor.mjs <instance-dir>` before service installation.
4. Create or bind tutor conversations. Each child MUST have a distinct conversation id.
5. Install/start the bridge with `scripts/service.mjs start <instance-dir>`.
6. Verify a child message reaches only that child's tutor and returns to the same Discord channel.
7. Verify the parent learning channel receives a concise learning event, not the raw transcript by default.

## Tutor behavior contract

Read `references/tutoring-behavior.md` when creating or repairing tutor conversations.

- Teach before giving the final answer when pedagogically useful.
- Diagnose existing understanding and prefer hints or guided questions.
- Ask one focused question at a time when interactive teaching is appropriate.
- Use age/grade-appropriate language.
- Verify understanding with demonstrated evidence rather than accepting “I understand” as mastery.
- Keep each child's context separate.

## Parent observation contract

Read `references/parent-observation.md` when configuring the parent channel or reports. Default parent output is learning telemetry: topic, evidence, misconception, progress, next step, and tutor note. Do not mirror every child message into the parent channel by default.

## Runtime boundary

The bundled `runtime/tutor-bridge` is part of this skill. It owns deterministic transport and lifecycle only: Discord connection, routing, serialized per-child queues, exact ChatGPT conversation binding, retries/failure reporting, parent transport, and service lifecycle.

Tutoring intelligence belongs in the ChatGPT tutor conversation and this skill contract, not in a second local LLM or OpenAI API adapter.

The preferred subscription-backed backend is DevMacBridge's loopback `chatgpt_conversation_start` wrapper. See `references/chatgpt-backend.md`.

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

- Never commit Discord tokens, DevMacBridge bearer tokens, child transcripts, or runtime state.
- A child channel must map to exactly one child.
- A tutor conversation must map to exactly one child.
- Parent control commands must come only from the configured parent control channel.
- Treat child personal data as private runtime data.
