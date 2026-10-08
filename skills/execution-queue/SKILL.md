---
name: execution-queue
description: Durable SQLite-backed CLI execution queue with a PM2-managed worker, per-queue concurrency and shared in-flight dedupe. Use for expensive local CLI tasks such as media inference/generation.
---

# Execution Queue

Run all expensive queued commands through `queue.mjs run --queue media-ai -- COMMAND ARGS...`; this waits for completion and streams output. Use `submit` to return a job ID asynchronously. A single PM2 `neo-queue-worker` process owns dispatch and persists jobs in `~/.neo/execution-queue/queue.sqlite`.

## Commands

```sh
node ~/.agents/skills/execution-queue/queue.mjs status
node ~/.agents/skills/execution-queue/queue.mjs run --queue media-ai -- /bin/echo smoke
node ~/.agents/skills/execution-queue/queue.mjs submit --queue media-ai -- /bin/echo async
node ~/.agents/skills/execution-queue/queue.mjs list
node ~/.agents/skills/execution-queue/queue.mjs cancel JOB_ID
```

Default `media-ai` concurrency is always 1. `NEO_QUEUE_CAPACITIES` configures non-media queues. `--timeout MS`, `--dedupe KEY` and `--retries N` are opt-in. See README.md. Do not claim this alone integrates Markcut's CLI; Markcut must invoke the queue explicitly.

Manage the worker using `npx pm2 start|restart|stop|describe neo-queue-worker`; use `npx pm2 save` after confirmed healthy startup. Reuse the existing instance, never start duplicates.
