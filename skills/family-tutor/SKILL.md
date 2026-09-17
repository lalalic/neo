---
name: family-tutor
description: Create and operate a persistent AI tutor for one or more children using ChatGPT subscription-backed conversations, with Discord child channels, parent observation/control, separate child context, and a managed tutor-bridge service.
---

# family-tutor

## What this skill enables

Create a family tutoring system in which each child has an independent ChatGPT Project, a dedicated warm ChatGPT tab, rotating tutor threads, and one local durable `AGENTS.md`. Parents can observe useful learning signals and set goals through Discord, and a long-running bridge connects Discord to ChatGPT without requiring OpenAI API billing.

Capability tree:

1. initialize a family-tutor instance;
2. create/bind one independent ChatGPT Project and dedicated warm tab per child;
3. route Discord messages deterministically to the correct child Project/tab and current thread;
4. apply tutoring behavior that teaches rather than simply answers;
5. provide parent observation and control without indiscriminate transcript mirroring;
6. install, inspect, restart, and diagnose the tutor-bridge service;
7. rotate overly long/noisy ChatGPT threads while preserving continuity through local `AGENTS.md`;
8. keep provider/channel adapters replaceable.

## Primary workflow

1. Create an instance from `templates/` or use `scripts/init-instance.mjs`.
2. Configure children, Discord channel ids, the parent channel, and the ChatGPT Project id.
3. Run `scripts/doctor.mjs <instance-dir>` before service installation.
4. Create or bind one ChatGPT Project per child and configure one dedicated background tab for that Project. Do not persist ChatGPT conversation ids locally.
5. Install/start the bridge with `scripts/service.mjs start <instance-dir>`.
6. Verify the real Discord path, not only backend health: send distinct probe messages from each child channel, confirm each reaches that child's Project/tab, and confirm the expected reply returns to the same Discord channel without cross-child leakage. When there are multiple children, test them close together so one stalled tutor cannot silently block another.
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

## Project, memory, and thread contract

- Each child MUST have a separate ChatGPT Project with child-specific Project custom instructions. Stable tutoring behavior, privacy rules, learner identity, parent telemetry format, durable-memory protocol, and thread-rollover policy belong in those Project instructions rather than being re-sent in every turn.
- Each child uses one dedicated warm ChatGPT tab. The tab remains on that Project's active conversation so ordinary turns continue without reloading the Project or reconstructing a local conversation binding.
- Local durable learner context lives only at `<instance-dir>/<child-id>/AGENTS.md`. Do not create local transcript/session folders or a conversation `state.json`. ChatGPT owns thread history.
- The bridge prepends the current `AGENTS.md` to each turn. The tutor may replace it by emitting `<FAMILY_TUTOR_MEMORY>...complete Markdown...</FAMILY_TUTOR_MEMORY>`; the bridge strips the block from the child response and atomically writes the replacement.
- When the current ChatGPT thread has become genuinely too long or noisy for effective tutoring, the tutor first captures any durable facts in the memory block, then emits `<FAMILY_TUTOR_ROLLOVER/>`. The bridge strips the marker and navigates that child's dedicated tab to the Project home so the next turn starts a fresh thread in the same Project. Do not rollover merely because the subject changed or after an arbitrary turn count.

See `references/project-instructions.md` for the Project custom-instruction contract.

## Runtime boundary

The bundled `runtime/tutor-bridge` is part of this skill. It owns deterministic transport and lifecycle only: Discord connection, routing, serialized per-child queues, child Project/tab binding, durable-memory handoff, thread rollover, retries/failure reporting, parent transport, and service lifecycle.

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
