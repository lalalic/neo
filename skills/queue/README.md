# Neo execution queue

A local opt-in SQLite-backed CLI queue, independent of Agents Relay. Requires a Node release with built-in `node:sqlite` support (tested with Node 25.6.0).

## Start (single worker)

```sh
npx pm2 start ./skills/queue/queue.mjs --name neo-queue-worker -- worker
npx pm2 save
```

Only the **worker** owns execution; callers can submit concurrently. A single PM2-managed worker dispatches processes subject to per-queue concurrency limits. `media-ai` is hard-capped at **one active command** across all clients; other queue capacities default to one and can be configured with `NEO_QUEUE_CAPACITIES='{"fast":2}'` in the worker environment. No Redis or extra scheduler is required.

## Use

```sh
node ./skills/queue/queue.mjs run --queue media-ai -- /usr/bin/python3 script.py
node ./skills/queue/queue.mjs status
node ./skills/queue/queue.mjs list
node ./skills/queue/queue.mjs cancel JOB_ID
```

`run` waits and forwards stdout/stderr/exit status. `submit` returns a job ID instead. `--dedupe KEY` reuses a queued or running job. `--timeout MS` limits active runtime, not queue delay. `--retries N` enables up to N retries for nonzero exits (default zero); timeouts and cancellations are not retried. Use retries only for idempotent commands. Callers must pass explicit command+argv; no shell is spawned. Cache behavior stays in Markcut.

State lives under `~/.neo/execution-queue/` (override with `NEO_QUEUE_HOME` for tests). Logs are mode 0600 but may include application-sensitive output; terminal job logs are removed after seven days by the worker (override with `NEO_QUEUE_LOG_RETENTION_DAYS`, 1–365). Active logs are not byte-capped to preserve exact command output. The queue stores command argv and inherits worker environment, so do not supply secrets on command lines and configure worker env for model CLIs. The worker reaps previously owned process groups before accepting new work. Interrupted RUNNING commands are marked failed rather than automatically replayed; QUEUED commands remain durable. Graceful PM2 termination kills running process groups.

**Limitations:** Command output is persisted in per-job files so that multiple callers can read it; age-based terminal-log retention is supported but per-job byte caps and live log rotation are not implemented. `--dedupe` shares in-flight jobs, with waiter-aware cancellation for graceful signal handling; forced loss of a caller is cleaned from the waiter table on later cancellation, not proactively detected. Cross-repository Markcut templates and cached-result bypass validation require a separate Agents Relay-backed Markcut PR. Do not interpret this Neo PR alone as proof of Markcut integration.
