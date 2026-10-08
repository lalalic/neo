# Shared CLI execution queue for Neo

## Objective

Build a reusable, local, strictly sequential execution queue for arbitrary CLI commands, hosted as a single PM2-managed worker under the Neo project. The queue must be transparent to clients such as Markcut: replace only configured CLI templates with `neo-queue run --queue media-ai -- <program> <args...>`, preserving synchronous exit code/stdout/stderr semantics and Markcut's existing content-hash media cache. A nonwaiting `neo-queue submit` API may be provided for other clients.

## Architecture and behavior

- Service implementation lives in `neo/skills/execution-queue/` (or consistent existing shared-services layout). PM2 owns one long-lived worker. Use Node.js built-in SQLite if compatible with project-supported Node versions; do not require Redis. SQLite holds durable queued/running/completed/failed/cancelled states, ordering, dedupe, execution ownership, and audit metadata. Store command arguments with safe redaction for logs, avoid leaking credentials.
- Queue configuration supports names and configurable per-queue capacities; `media-ai` must default to *globally one running command* across vision, image and video generation, including across all Markcut players and CLI processes. Do not accidentally permit concurrent model tasks through different workers or restarts. FIFO for the same queue. Default general operations should not be queued without explicit opt-in.
- `neo-queue run --queue NAME -- COMMAND ARGS...` submits then waits, faithfully forwards stdout/stderr and exits with original exit status; signals must cancel/release the caller. Preserve cwd and safe environment without unnecessarily serializing secrets. Prefer explicit argv, not a shell, and support existing CLI templates with quoting through carefully tested wrappers.
- Cache remains entirely Markcut-owned. Support optional dedupe key when requested; sharing one execution among multiple callers must not cancel the task if another caller remains. Do not invent a separate media cache.
- Worker/runner handles bounded execution timeout (execution time excluding time spent queued), SIGTERM/grace/SIGKILL for owned child process groups and descendants, retry policy, and abnormal worker/parent death. Restart recovery MUST ensure previous model descendants are dead before accepting new media-ai jobs; do not rely on PM2 singleton alone.
- Provide queue status/list/cancel and operational diagnostics, bounded logs, PM2 setup/start/status commands following Neo's existing service management conventions, and optionally events-bus lifecycle events with stable job IDs. Keep queue independent from Agents Relay's orchestration scheduling.
- Integration: update Markcut's configurable image-generation and vision command paths to route through queue without changing core render/pipeline/cache logic. Markcut belongs to `lalalic/markcut`, so if a cross-repo change is necessary, create a separate Agents Relay-backed Markcut Job/PR before changing that repository. Provide exact documented CLI template settings; no PATH interception.

## Acceptance tests

- Across 2+ independent client processes and Player instances, image and vision requests have active execution count <= 1; requests execute in FIFO order; same-key requests reuse the same in-flight work; existing cached result bypasses generation.
- `run` preserves original command exit code, stdout, stderr and cwd on success/failure; handles cancellation and timeouts, no shell injection.
- Force-stop a worker during nested CLI/Python simulation: no orphan descendants and no overlapping task after PM2 restart. Test recovery of queued jobs and of stale RUNNING state. No unrelated process is killed.
- Test PM2 startup/restart behavior without restarting NeoY, browser workspace, Chrome, or unrelated PM2 services. Review code and run automated + practical end-to-end tests. No auto-merge until verified.

## Non-goals

Do not rebuild the Agents Relay Job/Task scheduler, introduce Redis, make Markcut maintain a second queue/database, or indiscriminately intercept all system CLI commands.
