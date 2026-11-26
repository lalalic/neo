# Extending Events Bus reply channels

Use this contract when a feature needs a correlated, streamed reply to a request (Models, Voice, Chat Gateway, Family Tutor, etc.). The **existing** Events Bus MCP `publish` tool is the only publisher; do not add a channel-specific MCP reporting tool or publish a reply as a Relay Job lifecycle event. Job event sources and lifecycle remain owned by Relay. For the transport boundary, see [transport protocol](../skills/events-bus/references/protocol.md); the shared validator lives in the Neo Harness Rust library `crates/neo-reply`.

## Capability / owner boundary

| Component | Owns | Does not own |
| --- | --- | --- |
| Producer (agent/tool caller) | Correlation source, incrementing segment `seq`, terminal event | Channel state storage, job status |
| Events Bus | Validate generic envelope, route NATS, return publish receipt | Replay, subscriber delivery/ack, response persistence |
| Channel listener | Subscribe before dispatch, validate correlation, apply events to its own response store | Other channels, Relay Job state |
| Channel application | Request lifecycle, timeout/reconciliation, client streaming, error UX | Events Bus transport internals |

## Wire contract (v1)

All four event types use the **same** `publish({type, source, data})` tool and the same source for one request:

```json
{"type":"reply.text","source":"reply/models/resp_0123456789abcdef0123456789abcdef01234567","data":{"seq":1,"text":"First segment"}}
```

- `source` = `reply/<channel>/<request_id>`. Channel: lowercase ASCII letters, digits, hyphens; starts with a letter; 1–32 characters. Request ID: opaque ASCII letters, digits, `_` or `-`; 8–100 characters. Never put PII, tokens or payloads into IDs. The **channel owner** defines and verifies its request IDs; e.g., Models requires `resp_` plus 40 lowercase hex digits. Source is routing/correlation, **not authorization**.
- `reply.text` requires exactly `data.seq` (safe positive integer beginning with 1) and nonblank `data.text` (at most 100,000 characters). Each successive distinct fragment increments `seq` by 1. A text fragment **never completes** the turn.
- `reply.heartbeat` takes `data:{}`. It is optional liveness, **not** a report or terminal state.
- `reply.completed` takes `data:{}` and is a **separate event** after the final text fragment. Only this ends a successful request.
- `reply.failed` takes `data:{"error":"reason"}` (nonblank, at most 1,000 characters) and ends a failed request **instead of** completion.
- No extra `data` fields are accepted. The publisher must not fabricate terminal events on behalf of another request.

Given configured Job prefix `relay.events.job`, internal NATS subjects are `relay.events.reply.<channel>.<request_id>`; for a custom Job prefix, reply subjects derive from it using the shared `neo_reply::subject_prefix`. **Never hard-code the prefix in a consumer.** Replies do not appear in the Job history recorder; NATS subscriptions are live and non-replaying. A `published:true` result confirms transport publishing, not application delivery.

## Add a channel

1. Define the owning application, correlation-ID shape, state lifecycle and client delivery surface. Allocate a unique channel label (e.g., `voice`, `models`, `family-tutor`). Decide how retries, reconnects and timeouts reconcile uncertain outcomes.
2. Start a channel-specific listener **before** dispatching the request. Use the existing NATS subscriber with the channel-specific subject and wait for its handshake; validate the exact subject and envelope with `neo_reply::validate` before applying state. If startup fails, fail closed rather than silently waiting. Stop the listener on shutdown. The app owns terminal, deduplication and persistence policy; do not assume Event Bus retains reply history.
3. In `onEvent`, check the exact pending request ID, reject unrelated/stale requests and unexpected types, persist each accepted segment, and stream to the intended client. Accept an identical duplicate `seq` only if it is an exact replay; reject conflicting/out-of-order sequences. Apply terminal events once; ignore or reject late events without resurrecting a completed request. **Models' reference consumer** is `../services/models/src/reply.rs`; it owns response journal transitions.
4. Supply the agent's actual channel/request ID and the four-event contract in its per-turn instructions. Publish through the installed Events Bus `publish` MCP tool with exactly `type`, `source` and `data`. Do not infer the request ID or create a new reporting tool.
5. Verify negative and positive paths end to end, including a real producer acting through MCP, not just a test that manually publishes an event. Models is the verified native reference consumer; other channels must explicitly integrate and verify the shared library.

## Tests and compatibility gate

- **Contract:** accept valid `reply.text`/heartbeat/terminal, reject malformed source, oversized or extra fields, invalid sequence and wrong event type (`cargo test -p neo-reply`).
- **Routing:** use real NATS; verify subscribers receive only their own channel and replies never leak to Relay Job subscribers/history.
- **Application:** pending ID validation, identical replay vs conflict, out-of-order fragment, late event, duplicate terminal, error and timeout; restart/reconnect behavior and retention expectations.
- **Consumer:** prove actual user/client delivery and completion independently of publish acknowledgement. For Models specifically, the release gate is `services/models/MVP_GATE.md`: three autonomous Codex CLI scenarios (single turn, same-session TUI two turns, multi-fragment streaming), before merge **and** after live rollout. Never inject replies or call publish manually to satisfy this gate.

Wire v1 is intentionally closed. To add a reply **type** or **data field**, update the canonical validator, channel protocol, channel handlers and tests together; version or migrate incompatible changes without silently breaking existing clients. Adding another channel with the same four types needs an owning listener/response lifecycle and tests, **not** a new Events Bus tool or Job event family.
