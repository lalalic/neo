# events-bus eval matrix

- Correlation: child reuses caller `job_id`; nested child gets a new `task_id` plus `parent_task_id`.
- Lifecycle: started + milestones + exactly one terminal event.
- Visibility: orchestrator proactively surfaces `visibility=user` events.
- Throttling: numeric noise may be coalesced; blocked/error/phone.released/terminal events are never hidden.
- Failure: transport outage falls back to process output without claiming event delivery.
- Security: secrets and large content blobs are excluded from event payloads.
