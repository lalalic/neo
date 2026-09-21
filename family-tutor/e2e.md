# Family Tutor E2E verification

The release gate exercises the real Discord path through the single PM2-resident family-tutor-orchestrator, not only a service status check or a direct bridge probe.

## Preconditions

- The instance has browserBridge.enabled true, canonical child channel names, and a parent channel id.
- The host has the unpacked Family Tutor ChatGPT extension loaded and assigned to the exact Projects, plus a Discord bot token.
- Each child has a distinct child channel and durable `AGENTS.md` under the ignored instance directory.

## Critical checks

1. Send distinct probe messages to each child channel close together. Verify each reply returns to its originating channel and that one slow child does not block the other.
2. Confirm the child context is isolated: each child receives only its own durable memory and its own persistent ChatGPT Project thread.
3. Exercise voice and image messages. Verify audio is attached to ChatGPT for direct transcription/understanding and image attachment handling.
4. Send natural-language parent messages containing one or more configured child channel mentions anywhere, then send a no-mention follow-up. Verify fan-out, remembered runtime-only targets, exact Project suffixes, and privacy-filtered combined replies. /status remains covered.
5. Have a tutor response emit a complete FAMILY_TUTOR_MEMORY block. Verify only the child's AGENTS.md changes and no transcript or parent-routing state is written.
6. Inspect the instance: no transcript files or learner state outside each child `AGENTS.md` are created. Browser Project/tab bindings may exist only in private extension runtime state.

## Evidence

Capture Discord message ids/channels, service logs, the child `AGENTS.md` diff, and the thread-state transition in the ignored run directory. Do not commit those artifacts or any credentials.
