# Events Bus subject namespace cutover — operator runbook

**Not yet applied to live Neo Master services.** Target subject prefix is
`relay.events.job`; transport environment names are exclusively `EVENTS_BUS_*`.
This is a coordinated deployment, not a backward-compatible environment alias.

1. Inventory active Relay Jobs and any other producers/consumers (including
   the Events Bus recorder, CLI helper, Neo package-service-updater,
   `chat-gateway/server` (Neo Mobile Job notifications), remote worker
   processes and other notification subscribers). Never switch a Job's
   running event stream while consumers still subscribe to the old subject.
2. Drain or explicitly suspend existing Jobs at a safe lifecycle boundary.
   Preserve the current runtime JSON and `events.jsonl` history bytes as an
   immutable backup; do not truncate, rewrite or rename history rows.
3. Ensure every publisher, recorder, and consumer is upgraded to code using
   `EVENTS_BUS_NATS_URL`, `EVENTS_BUS_API_URL`,
   `EVENTS_BUS_SUBJECT_PREFIX` and `EVENTS_BUS_CONFIG`. Remove any retired
   Neo/Relay event environment overrides from managed service definitions.
4. Atomically update the existing Events Bus `runtime.json` field
   `subjectPrefix` to `relay.events.job` (retain the remaining connection,
   API and data-directory values). This changes configuration, **not** the
   NATS broker or stored history.
5. Restart/enable the recorder, all publishers, Relay consumers,
   `chat-gateway/server`, and optional package updater under the same new prefix. Verify `events-bus config`,
   `events-bus health`, and the service manager's effective environment.
6. Publish a new uniquely identified non-terminal test event, confirm the
   subject is `relay.events.job.<job_id>.<type>`, and verify it appears in the
   HTTP `/events` history, Relay subscription and Chat Gateway terminal-state
   notification delivery/reconciliation before resuming real Jobs.
   Ensure no new publisher is still emitting the retired subject.
7. Resume suspended Jobs only after end-to-end read-back. In case of failure,
   suspend writes again before restoring the entire publisher/consumer
   configuration together. Never let old and new subjects run as competing
   authoritative Job streams.

Source code intentionally refuses an unmigrated saved subject prefix unless
`EVENTS_BUS_SUBJECT_PREFIX` is supplied explicitly. Malformed or unreadable
runtime JSON also fails closed rather than reverting to default endpoints or
Subjects. A genuinely absent configuration file is the fresh-install case.
Bypassing the guard on only one service is **not** an acceptable production cutover.
