# Event-driven Relay live watch

Watch an **existing** local Relay Job on Neo Master with NATS events. This
feature is separate from ChatGPT scheduled tasks and does not poll hourly.

```sh
node skills/chat-gateway/cli/chat-gateway.mjs watch add vlog 629 --apply
bash skills/chat-gateway/neo-project restart
node skills/chat-gateway/cli/chat-gateway.mjs health
# Later, to disarm:
node skills/chat-gateway/cli/chat-gateway.mjs watch remove vlog 629 --apply
bash skills/chat-gateway/neo-project restart
```

The registry is private (`~/.local/state/neo/chat-gateway/live-watches.json`),
scoped by exact repository and Job ID and limited to 20 watches. Registration
requires an existing nonterminal Job, takes the Events Bus history cursor as a
baseline, and does not replay old milestones. A second NATS subscription to
`relay.events.job.*.>` decodes only allowlisted, identity-bound lifecycle
events. It persists a deduplicated Orchestrator request to the existing Chat
Gateway ledger and dispatches immediately, not at a scheduled interval.

The Orchestrator **must** inspect the authoritative Relay CLI state before
reporting. The legacy watch dispatcher still documents `chat_report` as a
compatibility mechanism; this is **not** the current phone Chat delivery
contract (which is Models REST/SSE and Events Bus reply envelopes). It uses
attention reports for failures, blocked reviews and human decisions, and `info`
for routine milestones. NATS is never approval or completion evidence. The user's
Review decisions are not synthesized; no publishing, cancellation or repeat
Job creation occurs as a result of a notification.

On startup and NATS reconnect, the watcher compares the private high-water
cursor with Events Bus history and queues missed events once. The NATS stream
is immediate; history is catch-up evidence only. An unavailable dashboard or
history API does not cause unverified notifications. Dispatch failures retain
stable request IDs for retry by the existing Chat Gateway dispatcher. The
`/health` response includes a separate `liveWatch` connection/count field and
shows `degraded` if a configured live subscriber is disconnected.

This watcher delivers to the configured Orchestrator head, not to the ChatGPT
thread that registered the watch. It does not assert physical iPhone push
receipt; actual push still depends on the Neo notification path and policy.

## Mobile push delivery

The gateway sends attention reports through Neo Master's loopback-only native
APNs `POST /mobile/notify` endpoint, not foreground iPhone MCP calls. Device
IDs come from Neo's private registry; device tokens are not transmitted by the
gateway or written to its logs. The current Neo notification policy is checked
before each send. One native APNs request fans out to the registered devices without duplicate pushes. Only an APNs-accepted request is acknowledged; a failure
remains pending in the existing retry ledger. Apple acceptance is not proof
that iOS displayed an alert.
