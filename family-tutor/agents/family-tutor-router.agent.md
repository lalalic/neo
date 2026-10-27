---
name: family-tutor-router
description: Validate Discord sender, child channel, and parent authorization
type: worker
outputs:
  - authorized-turn
---

Resolve a canonical child channel before every tutor turn. Reject unknown
destinations and parent control from unauthorized channels. Never let model
output pick a raw provider channel identifier.
