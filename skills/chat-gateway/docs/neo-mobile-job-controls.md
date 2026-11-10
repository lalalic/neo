# Neo Mobile Job controls

## Source and authorization

The tools use the existing loopback chat-gateway behind the authenticated Neo.app remote MCP federation. Relay data comes from two public interfaces:

- `/api/jobs?inventory=1` for the complete dashboard Job inventory and source-backed `createdAt`; the existing `chat_jobs` command remains unscoped for compatibility.
- `/api/job?id=JOB_ID&repo=OWNER/REPO` for exact Job identity before activity or cancellation.
- the Events Bus public ascending history API for durable, cursor-ordered Job/Task events.

Cancellation uses Relay's supported repository-scoped `POST /api/job-state?id=JOB_ID&state=CANCELLED&repo=OWNER/REPO` endpoint. Relay applies its Job cancellation Graph and cancels unfinished Tasks; a PR number is never required.

## MCP commands

`chat_jobs` remains compatible and adds a validated ISO 8601 `createdAt` string:

```json
chat_jobs({"limit": 20})
{
  "jobs": [{
    "id": "123", "title": "Feature work", "repository": "owner/repo",
    "status": "RUNNING", "createdAt": "2026-11-10T13:42:00.461Z",
    "updatedAt": "2026-11-10T13:52:00.000Z"
  }],
  "total": 1
}
```

`chat_job_activity` returns at most 100 whitelisted lifecycle events in durable history order. It contains only stable event type, owner-safe status/label, timestamp, and an optional sanitized task ID. Progress payloads, worker/model selections, paths, objectives, decisions, and raw metadata are deliberately dropped. `truncated` is true when the source contains additional history beyond the hard cap.

```json
chat_job_activity({"repository": "owner/repo", "jobId": "123"})
{
  "jobId": "123", "repository": "owner/repo",
  "source": "events-bus-history", "truncated": false,
  "events": [{
    "type": "task.progress", "status": "PROGRESS", "label": "Task progress",
    "timestamp": "2026-11-10T13:50:00.000Z", "taskId": "456"
  }]
}
```

`chat_job_cancel` accepts only `repository` and `jobId`. Eligibility is DRAFT or ACTIVE Relay Job state; COMPLETED and already-CANCELLED Jobs return truthful terminal readbacks without a second dispatch. Concurrent duplicate cancellations for the same identity fail safely, and a response is `cancelled` only after a subsequent authoritative readback says `CANCELLED`.

```json
chat_job_cancel({"repository": "owner/repo", "jobId": "123"})
{
  "status": "cancelled", "id": "123", "repository": "owner/repo",
  "title": "Feature work", "createdAt": "2026-11-10T13:42:00.461Z",
  "updatedAt": "2026-11-10T13:55:00.000Z"
}
```

## Validation and deployment gate

Isolated suites cover strict timestamp validation, repository identity scoping, event ordering and sanitization, unavailable/empty source handling, no-PR cancellation eligibility, duplicate cancellation, and final `CANCELLED` readback. The Task did not restart canonical chat-gateway/server, create a network listener, alter Remote provider permissions, or cancel an owner Job.

No safe end-to-end staging route was exercised because enabling a dedicated Remote provider for an isolated gateway would alter Remote provider permissions, which this Task explicitly prohibited. Before production deployment, merge the reviewed source into the canonical checkout, run the mandatory Neox simulator and real iPhone send/receive gates, use an owner-approved temporary `chat-gateway-staging` Remote provider only if needed, remove it after testing, then run canonical `setup --apply` and fresh authenticated contract/health checks.
