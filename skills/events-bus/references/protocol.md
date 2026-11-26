# Generic Events Bus transport protocol

## Publish

MCP and CLI accept precisely `type`, `source`, and optional object `data`.

    {"type":"example.changed","source":"example/item/123","data":{"value":42}}

The MCP gateway command facade uses `{"command":"publish","args":{...}}`.
The trusted local HTTP POST /events accepts those fields and an optional
`event_id` supplied by the producer to make retries identifiable.

Wire envelope contains type, source.id (the exact source), data, version,
event_id, timestamp. No job ID, lifecycle status, reply channel, release
registry, or other business projection is derived by the transport.
Legacy direct NATS envelopes with producer-generated extra fields are
recorded unchanged (apart from the receipt timestamp).

## Route

The configured transport routing table selects a subject prefix, source
token indices, optional type suffix and persistence policy. A fallback
routes arbitrary sources via an encoded token. This is routing configuration,
not a domain schema or authorization mechanism. A standalone bus can use
an empty route list and a fallback prefix. Neo's installed routing preserves
existing NATS subjects for the three deployed namespaces. Live-only subjects
are not recorded. Subscribe before dispatch; NATS core subscriptions do
not replay. Keep NATS and HTTP private.

## Query

GET /events accepts optional source, sourcePrefix, type, subject, after
(exclusive nonnegative cursor), limit (1–500), order (asc or desc), and filter
(JSON array of OR groups, each an array of AND conditions). A condition
has path (dot-delimited JSON field within the history row), op (eq, prefix
or prefixSegment), and string value. prefixSegment matches exactly one
nonempty slash-free remainder. No executable filters or regular expressions.

Example:

    /events?sourcePrefix=example%2F&order=desc&limit=20

The response contains events (cursor, subject, event), next_cursor and order.
CLI history offers the corresponding --source, --source-prefix, --type,
--subject, --filter, --after, --limit and --order flags.
GET /config and /health expose local transport configuration and health.

The bus never decides task state, process liveness, release validity or
reply completion. Those operations belong to the corresponding consumer.
A published:true receipt is not proof of application processing.
