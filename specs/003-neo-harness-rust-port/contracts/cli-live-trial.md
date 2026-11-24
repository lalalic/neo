# Neo Master native CLI live trial

Approved rollout: synchronize current main; build and verify optimized native
CLI; merge and push main; stage the verified executable with the corresponding
committed Agents, Skills and Compute assets under a private versioned prefix;
atomically replace the host's default `neo` symlink. Preserve the prior Node
entrypoint via `neo-node` for rollback. Do not change unrelated worktrees or
Project Git state, publish npm packages, upgrade other hosts, or delete Node
core during this trial. A failed post-switch smoke must restore the prior
launcher. Verify the installed binary, manifest Git revision, bootstrap,
workspace, catalog, project Run help/dry-run, local Neo.app MCP and doctor.
The host activation receipt records actual installation status.

The latest declared-DAG contract (main 0141644) supersedes the historical
caller-preflight tests: `neo project run` accepts no caller `--preflight`
option. The validated project/Graph/Run contract supplies Relay's internal
`--preflight=true` on creation. Other ordinary Job creation rules, review
and publication gates are unchanged. Both native and Node references reject
obsolete caller options. A real isolated Relay verifies creation and resume.

Remaining trial work: managed Final Review, actual Computer Use UI writes,
interactive Escalation Learn, real provider TLS/WSS/Docker and authorized
paid GPU operations. An intermittent isolated Relay CLI error was observed
before successful reruns; fixture-only subprocess stderr is now captured
for future diagnosis. This is not claimed as a resolved product defect.
