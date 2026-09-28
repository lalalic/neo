#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const [, , type, status, visibility, message, progressJson = ""] = process.argv;
if (!type || !status || !visibility || !message) {
  console.error("usage: emit.mjs <type> <status> <visibility> <message> [progress-json]");
  process.exit(2);
}

const jobId = process.env.NEO_JOB_ID;
const taskId = process.env.NEO_TASK_ID;
if (!jobId || !taskId) {
  console.error("NEO_JOB_ID and NEO_TASK_ID are required");
  process.exit(2);
}

let progress;
if (progressJson) {
  progress = JSON.parse(progressJson);
}

const event = {
  version: 1,
  event_id: randomUUID(),
  job_id: jobId,
  orchestrator_id: process.env.NEO_ORCHESTRATOR_ID || null,
  task_id: taskId,
  parent_task_id: process.env.NEO_PARENT_TASK_ID || null,
  type,
  status,
  timestamp: new Date().toISOString(),
  source: {
    ...(process.env.NEO_EVENT_SOURCE ? { id: process.env.NEO_EVENT_SOURCE } : {}),
    agent: process.env.NEO_AGENT || "agent",
    host: os.hostname(),
  },
  visibility,
  level: process.env.NEO_EVENT_LEVEL || (status === "failed" ? "error" : "info"),
  message,
  ...(progress ? { progress } : {}),
  data: {
    ...(process.env.NEO_WORKER_PID ? {
      worker: {
        kind: "process",
        pid: Number(process.env.NEO_WORKER_PID),
        ...(process.env.NEO_WORKER_PGID ? { process_group_id: Number(process.env.NEO_WORKER_PGID) } : {}),
        host: process.env.NEO_WORKER_HOST || os.hostname(),
      },
    } : {}),
  },
};

const subject = `neo.events.job.${jobId}.${type}`;
const here = path.dirname(fileURLToPath(import.meta.url));
const transport = path.resolve(here, "../transport/nats.mjs");
const result = spawnSync(process.execPath, [transport, "pub", subject, JSON.stringify(event)], {
  encoding: "utf8",
  env: process.env,
});

if (result.status !== 0) {
  // Fallback required by the protocol: keep the same structured event visible in process logs.
  process.stderr.write(`${JSON.stringify(event)}\n`);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

process.stdout.write(`${JSON.stringify(event)}\n`);
