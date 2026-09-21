# Family Tutor E2E verification

The release gate exercises the real Discord path through the single PM2-resident `family-tutor-orchestrator`, not only a service status check or a direct Codex probe.

## Preconditions

- The instance has `codex.backend: codex`, child Discord channel ids, and a parent channel id.
- The host has an authenticated `codex` CLI and a Discord bot token.
- Each child has a distinct child channel and durable `AGENTS.md` under the ignored instance directory.

## Critical checks

1. Send distinct probe messages to each child channel close together. Verify each reply returns to its originating channel and that one slow child does not block the other.
2. Confirm the child context is isolated: each child receives only its own durable memory and its own persistent Codex thread.
3. Exercise voice and image messages. Verify local transcription and image attachment handling, with a useful error if either fails.
4. Send natural-language parent messages containing one configured child channel mention anywhere in the sentence (for example, `how's <#CHILD_CHANNEL_ID>'s recent status?` or `please have <#CHILD_CHANNEL_ID> review fractions tonight`). Verify the channel ID targets exactly that child's existing thread and the parent receives concise learning telemetry rather than a raw transcript. Existing `!goal`, `!focus`, and `!ask` commands and `/status` remain covered as compatibility checks.
5. Have a tutor response emit a complete `<FAMILY_TUTOR_MEMORY>` block and `<FAMILY_TUTOR_ROLLOVER/>`. Verify memory is written before `.codex-thread.json` is removed and that the next turn creates a fresh thread.
6. Inspect the instance: no transcript files or browser/project/tab bindings are created.

## Evidence

Capture Discord message ids/channels, service logs, the child `AGENTS.md` diff, and the thread-state transition in the ignored run directory. Do not commit those artifacts or any credentials.
