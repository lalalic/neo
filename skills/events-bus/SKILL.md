---
name: events-bus
description: Generic event publishing, NATS transport and durable event history.
requires:
  skills:
    - daemon-service-manage
---

# Events Bus

## Bootstrap

After installing the daemon-service-manage skill, run `events-bus setup`.
It declares exactly `events-bus/nats` and `events-bus/history` through
`serviceman`. Verify with `events-bus health`. Use the owning service
manager for coordinated restarts.

## Generic publication

MCP exposes exactly one tool, `publish`. MCP and CLI accept
`{"type":"example.changed","source":"example/item/123","data":{"value":42}}`.
Type and source are required; data is an opaque object and defaults to {}.
The bus assigns an event ID, wire version, and receipt timestamp; it does not
interpret domain data, task state, reply sequences, or publication success.

The trusted local HTTP POST /events also accepts an optional event_id for
producer-controlled idempotency. Never expose the general Events Bus API or
NATS to the internet. The bus receipt confirms transport publication, not
application delivery or durable completion.

CLI: `events-bus publish --file event.json` or one quoted JSON argument.
Local scripts: `node scripts/emit.mjs TYPE DATA_JSON` with
`EVENTS_BUS_EVENT_SOURCE` set to the producer's actual source.

## Observation

Use native NATS subscriptions, CLI history, or HTTP GET /events. Query by
source, sourcePrefix, type, subject, generic field filter, cursor, order, and
limit. See [transport protocol](references/protocol.md). Event history is not
authoritative application state. Publish after required application checks;
consumers validate correlation and reconcile delivery.

## Domain ownership

- Job/task lifecycle and publication contracts: Agents Relay
  (`agents-relay` skill and its event contract; shared publication reporter
  in the Agents Relay repository).
- Streamed replies: Neo Harness shared `neo-reply` library and the owning channel application.
- Unknown event families require no Events Bus code changes.

Neo's declarative transport routing configuration preserves deployed NATS
subjects and persistence policy. It contains no domain validators or runtime
adapters. Source shapes and business validation belong to producers and
consumers. Coordinate consumer and recorder upgrades before switching
from the legacy enriched-envelope API; preserve all history bytes.
