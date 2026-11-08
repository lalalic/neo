# Requirements Checklist: Chat Gateway

**Purpose**: Validate completeness and clarity of the feature requirements.
**Created**: 2026-11-08
**Feature**: [spec.md](../spec.md)

## Requirement Quality

- [x] CHK001 Each requirement has a stable identifier and testable behavior.
- [x] CHK002 The three user stories are independently testable with injected adapters.
- [x] CHK003 Terminal states and the idempotency key are explicit.
- [x] CHK004 First-start baseline, restart gap and reconciliation behavior are explicit.
- [x] CHK005 Notification content limits (no objectives, paths or secrets) are explicit.
- [x] CHK006 Reporting is optional and thread-initiated; no liveness tracking is required.
- [x] CHK007 Environment resolution order and the heuristic fallback are explicit.
- [x] CHK008 No change to Relay, Events Bus, dashboard, Neo MCP or ChatGPT is required.
- [x] CHK009 Out-of-scope phases (courier, thread chain, job tracking, Chat tab UI, human-input flows) are listed.
- [x] CHK010 Success criteria can be verified by local isolated tests.

## Open Items Before Implementation

- [ ] CHK011 Resolve research O1: how a PM2 service invokes the Neo events notification (blocks T014).
- [ ] CHK012 Confirm O2: mapping for `CANCELLED` notifications.
- [ ] CHK013 Confirm O3: published npm package versus project-owned local service.

## Notes

Items CHK001 to CHK010 were reviewed against the specified contract. Implementation progress is tracked in `tasks.md`.
