---
name: mobile-notification
description: Neo-owned private APNs notification and durable iPhone review inbox, with an authenticated mobile-only MCP protocol for registration and acknowledgments.
---

# Neo mobile notification

## Goal

Allow Neo integrations to persist a review request and wake registered iPhones
without exposing a generic notification MCP Tool or requiring the calling
Agent to provide a device ID. Neo Mobile can then fetch requests and report
review decisions through the authenticated existing gateway.

## Use

- **Neo integrations:** import `notifyReview` directly from `apns.mjs` and send
  an immutable review request only after its content is available. Verify the
  `{stored:true,requestId}` receipt; APNs acceptance alone is not delivery.
- **Neo Mobile:** use `mcp.neox-apns` with `review.push.register`,
  `review.push.pending`, or `review.push.complete`. `review.push.status` gives
  nonsensitive diagnostics. There is intentionally no `review.push.notify` tool.
- **Standalone admin:** `node review-cli.mjs notify < request.json` uses the
  same private module, not the MCP notification surface.

Registration associates a caller-provided device ID and APNs token locally at
`~/Library/Application Support/NeoY/apns/`. Normal notification sends choose
registered devices automatically; `deviceId` is an optional targeting filter.
Device tokens and Apple signing keys stay in the 0700 local data directory and
are never returned in tool responses or carried in APNs payloads.

A review decision is validated and emitted by Neo Mobile via the existing
EventBus contract. The phone then acknowledges its Inbox entry; Neo Relay owns
Task resume. The notification provider must not invent execution identities.

Run `node --test apns.test.mjs mcp.test.mjs` inside this directory before
changing registration, delivery, or the mobile protocol.
