# Neo Mobile notifications (Neo-owned)

This is the private APNs and durable Review Inbox implementation for Neo Master.
The APNs signing key, token registry, and review store are not committed; they
remain under `~/Library/Application Support/NeoY/apns/`.

- `apns.mjs`: programmatic `notifyReview`, registration and Inbox management.
- `mcp.mjs`: authenticated **mobile-client** protocol (`review.push.register`,
  `review.push.pending`, `review.push.complete`, `review.push.status`). **No
  notification MCP Tool is exposed.**
- `review-cli.mjs`: optional local terminal notification bridge.

The native Neo Mobile app uses the unchanged `mcp.neox-apns` provider name for
its mobile protocol. Its Federation URL can point at this `mcp.mjs` directly.
See `SKILL.md` for operational contracts and verification.
