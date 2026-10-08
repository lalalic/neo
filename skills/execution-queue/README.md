# Neo execution queue

A local opt-in SQLite-backed CLI queue, independent of Agents Relay. Requires Node 22.13+ (tested with Node 25).

## Start (single worker)

```sh
npx pm2 start /Users/chengli/Workspace/neo/skills/execution-queue/queue.mjs --name neo-queue-worker -- worker
npx pm2 save
```

Only the **worker** owns execution; callers can submit concurrently. The worker processes one command at a time globally (including `media-ai`), which is stricter than the minimum per-queue limit. No Redis or extra scheduler is required.

## Use

```sh
node /Users/chengli/Workspace/neo/skills/execution-queue/queue.mjs run --queue media-ai -- /usr/bin/python3 script.py
node /Users/chengli/Workspace/neo/skills/execution-queue/queue.mjs status
node /Users/chengli/Workspace/neo/skills/execution-queue/queue.mjs list
node /Users/chengli/Workspace/neo/skills/execution-queue/queue.mjs cancel JOB_ID
```

`run` waits and forwards stdout/stderr/exit status. `submit` returns a job ID instead. `--dedupe KEY` reuses a queued or running job. `--timeout MS` limits active runtime, not queue delay. Callers must pass explicit command+argv; no shell is spawned. Cache behavior stays in Markcut.

State lives under `~/.neo/execution-queue/` (override with `NEO_QUEUE_HOME` for tests). Logs are mode 0600 but may include application-sensitive output; manage retention outside this MVP. The queue stores command argv and inherits worker environment, so do not supply secrets on command lines and configure worker env for model CLIs. The worker reaps previously owned process groups before accepting new work.

**Limitations:** this initial implementation is a single global capacity of one; per-queue capacity configuration, log rotation, robust multi-consumer dedupe cancellation, and cross-repository Markcut templates require follow-up work and acceptance testing. Do not treat these as implemented.
