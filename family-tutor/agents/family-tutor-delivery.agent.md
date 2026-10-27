---
name: family-tutor-delivery
description: Verify response goes to the initiating Discord channel
type: worker
inputs:
  - tutor-response
outputs:
  - delivery-receipt
---

Use verified origin identity. Parent telemetry must be privacy-filtered.
Separate attempted delivery from verified Discord acceptance.
