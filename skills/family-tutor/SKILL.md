---
name: family-tutor
description: Create and operate a persistent browser-backed ChatGPT tutor for one or more children using Discord child channels, parent observation/control, separate child context, and a PM2-managed tutor orchestrator service.
---

# family-tutor

## What this skill enables

Create a family tutoring system in which each child has an independent persistent ChatGPT Project thread and one local durable `AGENTS.md`. Parents can observe useful learning signals and set goals through Discord, and one long-lived PM2 orchestrator connects Discord to ChatGPT through a browser bridge.

Capability tree:

1. initialize a family-tutor instance;
2. bind one independent persistent ChatGPT Project thread per child;
3. route Discord messages deterministically to the correct child and current Project thread;
4. apply tutoring behavior that teaches rather than simply answers;
5. provide parent observation and control without indiscriminate transcript mirroring;
6. install, inspect, restart, and diagnose the `family-tutor-orchestrator` PM2 service;
7. preserve continuity through local `AGENTS.md` when a Project thread changes;
8. keep provider/channel adapters replaceable.

## Primary workflow

1. Create an instance from `templates/` or use `scripts/init-instance.mjs`.
2. Configure children by canonical Discord channel name (`id: "sammy"` for `#sammy`) and the parent channel. Enable the loopback `browserBridge`.
3. Run `scripts/doctor.mjs <instance-dir>` before service installation.
4. Load the unpacked ChatGPT extension and assign one exact Project tab to each child. The runtime persists only private bridge state; it never persists transcripts.
5. Install/start the orchestrator with `scripts/service.mjs start <instance-dir>`.
6. Verify the real Discord path, not only bridge health: send distinct probe messages from each child channel, confirm each reaches that child's Project thread, and confirm the expected reply returns to the same Discord channel without cross-child leakage. When there are multiple children, test them close together so one stalled tutor cannot silently block another.
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

The runtime registers a parent-only Discord `/status` command at startup. It accepts an optional child Discord channel selector, derives the child id from that channel's exact name, and queries `neo/family-tutor/<channel-name>` plus that learner's existing Project/thread and `AGENTS.md` context. A missing or mismatched Project is a configuration error. With no child channel it queries each configured learner for a compact overview. Parent messages in the configured parent channel may mention the child channel naturally anywhere in the sentence; the channel name is the only child routing key. Requests outside `discord.parentChannelId` are denied, and `/status` creates no new durable learner-state files.

## Browser, memory, and thread contract

- Each child MUST have a separate persistent ChatGPT Project thread. Stable tutoring behavior, privacy rules, learner identity, parent telemetry format, and durable-memory protocol are supplied by the runtime and skill contract.
- Local durable learner context lives at `<instance-dir>/<child-id>/AGENTS.md`; browser and correlation state is private runtime state. Do not create local transcript/session folders.
- The orchestrator prepends the current `AGENTS.md` to each turn. The tutor may replace it by emitting `<FAMILY_TUTOR_MEMORY>...complete Markdown...</FAMILY_TUTOR_MEMORY>`; the orchestrator strips the block from the child response and atomically writes the replacement.
- Keep the same persistent Project thread for the learner. If a future browser-supported rollover is needed, capture durable facts in `AGENTS.md` first; never create a second parent memory store.

See `references/project-instructions.md` for the child ChatGPT Project contract.

## Runtime boundary

When an accepted child-channel or parent-control message enters the tutor
queue, the Discord runtime reacts to the original message and posts the
temporary `Neo is thinking…` signal immediately. Both are cleared when the
turn completes or fails. This state is keyed only by the in-flight Discord
message, is deduplicated while active, and is never written to learner memory,
thread state, or another durable store.

The bundled `runtime/tutor-orchestrator` is the single long-lived PM2 service for this skill. It owns Discord transport, exact-name routing, serialized per-child browser turns, durable-memory handoff, retries/failure reporting, parent transport/telemetry, and service lifecycle. The loopback browser bridge and extension own ChatGPT tab interaction and multimodal attachments.

Tutoring intelligence belongs in the persistent ChatGPT Project thread and this skill contract, not in a second local LLM or API adapter. See the canonical architecture in family-tutor/docs/architecture.md.

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

- Never commit Discord tokens, browser credentials, child transcripts, or runtime state.
- A child channel must map to exactly one child.
- A tutor thread must map to exactly one child.
- Parent control commands must come only from the configured parent control channel.
- Parent goals, guidance, and status questions mention a Discord child channel and run through the channel name's exact `neo/family-tutor/<channel-name>` Project, that child's existing persistent tutor thread, and its `AGENTS.md` as tagged parent context. Do not add aliases, separate name mappings, or channel-id-to-child mapping files. There is no second parent memory store.
- In the configured parent channel, authorized parents may write natural-language messages with one or more configured child channel mentions anywhere in the sentence. The exact channel name must match the child id and ChatGPT Project suffix. A later no-mention message reuses the last successfully resolved target set in runtime memory; an explicit set replaces it. Command-like prefixes and mention-at-start are not required.
- Discord audio attachments are forwarded directly to ChatGPT through the browser bridge with explicit voice-message context; local ASR is not the primary path.
- Proactively send only minimum-necessary parent telemetry for meaningful academic risk or serious safety/wellbeing concerns, with suggested action and child transparency when safe and appropriate.
- Treat child personal data as private runtime data.
