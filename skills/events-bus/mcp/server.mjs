#!/usr/bin/env node
import readline from "node:readline";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { connect } from "@nats-io/transport-node";

const SERVER_NAME = "events-bus-mcp";
const SERVER_VERSION = "0.1.0";
const NATS_URL = process.env.NEO_NATS_URL || "nats://127.0.0.1:4222";
const DATA_DIR = process.env.EVENTS_BUS_DATA_DIR || path.join(os.homedir(), "Library", "Application Support", "EventsBus");
const HISTORY_FILE = path.join(DATA_DIR, "events.jsonl");
const MAX_MEMORY_EVENTS = 20_000;
const MAX_WAIT_MS = 30_000;
const PROGRESS_RESOURCE_URI = "ui://events-bus/job-progress-v1.html";
const PROGRESS_MIME_TYPE = "text/html;profile=mcp-app";
const PROGRESS_HTML = fs.readFileSync(new URL("./job-progress.html", import.meta.url), "utf8");
const encoder = new TextEncoder();
const decoder = new TextDecoder();

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

let nextCursor = 1;
const events = [];
const waiters = new Set();
const PROCESS_CHECK_INTERVAL_MS = 500;
const PROCESS_EXIT_GRACE_MS = 500;

const EVENT_STATUSES = new Set(["queued", "running", "waiting", "blocked", "succeeded", "failed", "cancelled"]);
const EVENT_VISIBILITIES = new Set(["user", "orchestrator", "debug"]);
const EVENT_LEVELS = new Set(["debug", "info", "warning", "error"]);

const TERMINAL_JOB_TYPES = new Set([
  "job.completed",
  "job.failed",
  "job.blocked",
  "job.cancelled",
]);

function safeJobId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
}

function safeType(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.-]+$/.test(value);
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizePublishEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "event must be an object" };
  if (!safeJobId(input.job_id)) return { error: "invalid event.job_id" };
  if (!safeJobId(input.task_id)) return { error: "invalid event.task_id" };
  if (!safeType(input.type)) return { error: "invalid event.type" };
  if (!EVENT_STATUSES.has(input.status)) return { error: "invalid event.status" };
  if (!EVENT_VISIBILITIES.has(input.visibility)) return { error: "invalid event.visibility" };
  if (!nonEmptyString(input.message)) return { error: "event.message is required" };
  if (input.level !== undefined && !EVENT_LEVELS.has(input.level)) return { error: "invalid event.level" };
  if (input.version !== undefined && input.version !== 1) return { error: "event.version must be 1" };
  if (input.event_id !== undefined && !nonEmptyString(input.event_id)) return { error: "invalid event.event_id" };
  if (input.timestamp !== undefined && (!nonEmptyString(input.timestamp) || Number.isNaN(Date.parse(input.timestamp)))) {
    return { error: "invalid event.timestamp" };
  }

  const event = {
    ...input,
    version: 1,
    event_id: input.event_id ?? crypto.randomUUID(),
    timestamp: input.timestamp ?? new Date().toISOString(),
    level: input.level ?? "info",
    source: input.source && typeof input.source === "object" && !Array.isArray(input.source)
      ? input.source
      : { agent: "mcp", host: os.hostname() },
    data: input.data && typeof input.data === "object" && !Array.isArray(input.data) ? input.data : {},
  };
  return { event };
}

function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) return;
  const lines = fs.readFileSync(HISTORY_FILE, "utf8").split(/\r?\n/).filter(Boolean);
  for (const line of lines.slice(-MAX_MEMORY_EVENTS)) {
    try {
      const row = JSON.parse(line);
      if (!Number.isInteger(row.cursor) || !row.event || !row.subject) continue;
      events.push(row);
      nextCursor = Math.max(nextCursor, row.cursor + 1);
    } catch {}
  }
}

function appendEvent(subject, event) {
  const row = { cursor: nextCursor++, subject, event };
  events.push(row);
  if (events.length > MAX_MEMORY_EVENTS) events.splice(0, events.length - MAX_MEMORY_EVENTS);
  fs.appendFileSync(HISTORY_FILE, `${JSON.stringify(row)}\n`, { encoding: "utf8", mode: 0o600 });
  for (const waiter of [...waiters]) waiter(row);
  return row;
}

function rowsForJob(jobId, afterCursor = 0, limit = 100) {
  return events
    .filter((row) => row.cursor > afterCursor && row.event?.job_id === jobId)
    .slice(0, Math.max(1, Math.min(500, limit)));
}

function latestWorkerForJob(jobId) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const row = events[i];
    if (row.event?.job_id !== jobId) continue;
    const worker = row.event?.data?.worker;
    if (worker && typeof worker === "object" && !Array.isArray(worker)) return worker;
  }
  return null;
}

function latestTerminalForJob(jobId) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const row = events[i];
    if (row.event?.job_id === jobId && TERMINAL_JOB_TYPES.has(row.event?.type)) return row;
  }
  return null;
}

function processLiveness(jobId) {
  const worker = latestWorkerForJob(jobId);
  if (!worker) return { state: "unknown", reason: "worker_not_registered" };
  if (worker.kind !== "process") return { state: "unknown", reason: "worker_kind_not_process", worker };
  if (worker.host && worker.host !== os.hostname()) return { state: "unknown", reason: "worker_on_other_host", worker };
  const pid = Number(worker.pid);
  if (!Number.isInteger(pid) || pid <= 0) return { state: "unknown", reason: "invalid_worker_pid", worker };
  try {
    process.kill(pid, 0);
    return { state: "alive", pid, worker };
  } catch (error) {
    if (error?.code === "EPERM") return { state: "alive", pid, worker, reason: "permission_denied_but_process_exists" };
    if (error?.code === "ESRCH") return { state: "dead", pid, worker };
    return { state: "unknown", pid, worker, reason: error?.code || String(error) };
  }
}

function progressSnapshot(jobId) {
  const rows = rowsForJob(jobId, 0, 500);
  const latest = rows.at(-1)?.event ?? null;
  const terminal = latestTerminalForJob(jobId)?.event ?? null;
  const visible = rows
    .map((row) => row.event)
    .filter((event) => event?.visibility === "user")
    .slice(-8)
    .map((event) => ({
      event_id: event.event_id,
      task_id: event.task_id,
      type: event.type,
      status: event.status,
      timestamp: event.timestamp,
      level: event.level,
      message: event.message,
      ...(event.progress && typeof event.progress === "object" ? { progress: event.progress } : {}),
    }));
  const progressEvent = [...rows].reverse().map((row) => row.event).find((event) => event?.progress && typeof event.progress === "object");
  return {
    job_id: jobId,
    status: terminal?.status ?? latest?.status ?? "queued",
    terminal: Boolean(terminal),
    latest_message: latest?.message ?? "No event received yet.",
    updated_at: latest?.timestamp ?? null,
    event_count: rows.length,
    worker_liveness: processLiveness(jobId),
    progress: progressEvent?.progress ?? null,
    milestones: visible,
  };
}

function structuredResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
  };
}

function textResult(value, isError = false) {
  return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) };
}

const TOOLS = [
  {
    name: "health",
    description: "Check the events-bus MCP relay and NATS connection.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "wait",
    title: "Watch job progress",
    description: "Long-poll for new events belonging to one job after a cursor. Returns immediately on matching events, timeout, or when the registered worker process exits.",
    _meta: {
      "openai/toolInvocation/invoking": "Watching job progress…",
      "openai/toolInvocation/invoked": "Job progress checked",
    },
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        after_cursor: { type: "integer", minimum: 0, default: 0 },
        timeout_ms: { type: "integer", minimum: 0, maximum: MAX_WAIT_MS, default: 25000 },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
      },
      required: ["job_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "watch",
    title: "Establish job watch",
    description: "Establish a non-blocking cursor for one job before delegation. Does not consume or delete events.",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string", pattern: "^[A-Za-z0-9_-]+$" } },
      required: ["job_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "history",
    description: "Read stored events for one job after a cursor without waiting.",
    inputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        after_cursor: { type: "integer", minimum: 0, default: 0 },
        limit: { type: "integer", minimum: 1, maximum: 500, default: 100 },
      },
      required: ["job_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "status",
    description: "Return the latest known event and terminal state for one job.",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string" } },
      required: ["job_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "progress",
    title: "Show job progress",
    description: "Render a compact visual snapshot of one events-bus job.",
    inputSchema: {
      type: "object",
      properties: { job_id: { type: "string" } },
      required: ["job_id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        job_id: { type: "string" },
        status: { type: "string" },
        terminal: { type: "boolean" },
        latest_message: { type: "string" },
        updated_at: { type: ["string", "null"] },
        event_count: { type: "integer" },
        worker_liveness: { type: "object" },
        progress: { type: ["object", "null"] },
        milestones: { type: "array", items: { type: "object" } },
      },
      required: ["job_id", "status", "terminal", "latest_message", "updated_at", "event_count", "worker_liveness", "progress", "milestones"],
      additionalProperties: false,
    },
    _meta: {
      ui: { resourceUri: PROGRESS_RESOURCE_URI },
      "openai/outputTemplate": PROGRESS_RESOURCE_URI,
      "openai/toolInvocation/invoking": "Building job progress…",
      "openai/toolInvocation/invoked": "Job progress ready",
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "publish",
    description: "Publish one validated events-bus event. Intended for orchestrators/services that expose MCP but do not have a direct NATS client.",
    inputSchema: {
      type: "object",
      properties: {
        event: {
          type: "object",
          properties: {
            version: { type: "integer", const: 1 },
            event_id: { type: "string", minLength: 1 },
            job_id: { type: "string", pattern: "^[A-Za-z0-9_-]+$", description: "Use the caller-provided literal job_id; never use placeholders such as inherited/current." },
            task_id: { type: "string", pattern: "^[A-Za-z0-9_-]+$", description: "Use the caller-provided literal task_id." },
            parent_task_id: { type: ["string", "null"] },
            orchestrator_id: { type: ["string", "null"] },
            type: { type: "string", pattern: "^[A-Za-z0-9_.-]+$" },
            status: { type: "string", enum: ["queued", "running", "waiting", "blocked", "succeeded", "failed", "cancelled"] },
            timestamp: { type: "string" },
            visibility: { type: "string", enum: ["user", "orchestrator", "debug"] },
            level: { type: "string", enum: ["debug", "info", "warning", "error"] },
            message: { type: "string", minLength: 1 },
            source: { type: "object" },
            progress: { type: "object" },
            data: { type: "object" },
          },
          required: ["job_id", "task_id", "type", "status", "visibility", "message"],
          additionalProperties: false,
        },
      },
      required: ["event"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
];

loadHistory();
const nc = await connect({ servers: NATS_URL, name: SERVER_NAME });
const sub = nc.subscribe("neo.events.job.>");
void (async () => {
  for await (const msg of sub) {
    try {
      const event = JSON.parse(decoder.decode(msg.data));
      if (!safeJobId(event?.job_id) || !safeType(event?.type)) continue;
      appendEvent(msg.subject, event);
    } catch {}
  }
})();

async function waitForEvents(jobId, afterCursor, timeoutMs, limit) {
  const existing = rowsForJob(jobId, afterCursor, limit);
  if (existing.length > 0 || timeoutMs <= 0) {
    return { rows: existing, liveness: processLiveness(jobId), processExited: false };
  }

  const initialLiveness = processLiveness(jobId);
  if (initialLiveness.state === "dead" && !latestTerminalForJob(jobId)) {
    return { rows: [], liveness: initialLiveness, processExited: true };
  }

  return await new Promise((resolve) => {
    let done = false;
    let exitDetectedAt = null;
    const finish = (processExited = false) => {
      if (done) return;
      done = true;
      waiters.delete(onEvent);
      clearTimeout(timeoutTimer);
      clearInterval(processTimer);
      resolve({ rows: rowsForJob(jobId, afterCursor, limit), liveness: processLiveness(jobId), processExited });
    };
    const onEvent = (row) => {
      if (row.cursor > afterCursor && row.event?.job_id === jobId) finish(false);
    };
    waiters.add(onEvent);

    const timeoutTimer = setTimeout(() => finish(false), Math.min(MAX_WAIT_MS, Math.max(0, timeoutMs)));
    const processTimer = setInterval(() => {
      const liveness = processLiveness(jobId);
      if (liveness.state !== "dead") {
        exitDetectedAt = null;
        return;
      }
      if (latestTerminalForJob(jobId)) {
        finish(false);
        return;
      }
      if (exitDetectedAt === null) {
        exitDetectedAt = Date.now();
        return;
      }
      if (Date.now() - exitDetectedAt >= PROCESS_EXIT_GRACE_MS) finish(true);
    }, PROCESS_CHECK_INTERVAL_MS);
  });
}

async function callTool(name, args = {}) {
  if (name === "health") {
    await nc.flush();
    return textResult({ ok: true, server: nc.getServer(), buffered_events: events.length, next_cursor: nextCursor });
  }
  if (name === "watch" || name === "wait" || name === "history" || name === "status" || name === "progress") {
    if (!safeJobId(args.job_id)) return textResult({ error: "job_id must contain only letters, digits, _ or -" }, true);
  }
  if (name === "watch") {
    await nc.flush();
    await new Promise((resolve) => setImmediate(resolve));
    const rows = events.filter((row) => row.event?.job_id === args.job_id);
    return textResult({
      job_id: args.job_id,
      watch_established: true,
      after_cursor: rows.at(-1)?.cursor ?? 0,
      buffered_event_count: rows.length,
      worker_liveness: processLiveness(args.job_id),
    });
  }
  if (name === "history") {
    const rows = rowsForJob(args.job_id, args.after_cursor ?? 0, args.limit ?? 100);
    return textResult({ job_id: args.job_id, events: rows, next_cursor: rows.at(-1)?.cursor ?? (args.after_cursor ?? 0) });
  }
  if (name === "wait") {
    const result = await waitForEvents(args.job_id, args.after_cursor ?? 0, args.timeout_ms ?? 25_000, args.limit ?? 100);
    const terminal = latestTerminalForJob(args.job_id);
    return textResult({
      job_id: args.job_id,
      events: result.rows,
      next_cursor: result.rows.at(-1)?.cursor ?? (args.after_cursor ?? 0),
      timed_out: result.rows.length === 0 && !result.processExited,
      worker_liveness: result.liveness,
      process_exited_without_terminal: result.processExited && !terminal,
      stop_wait_loop: Boolean(terminal) || result.processExited,
      end_reason: terminal ? "terminal_event" : (result.processExited ? "worker_exited" : null),
      terminal_event: terminal,
    });
  }
  if (name === "progress") {
    return structuredResult(progressSnapshot(args.job_id));
  }
  if (name === "status") {
    const rows = rowsForJob(args.job_id, 0, 500);
    const latest = rows.at(-1) ?? null;
    const terminal = [...rows].reverse().find((row) => ["succeeded", "failed", "cancelled", "blocked"].includes(row.event?.status)) ?? null;
    return textResult({ job_id: args.job_id, latest, terminal, event_count: rows.length, worker_liveness: processLiveness(args.job_id) });
  }
  if (name === "publish") {
    const normalized = normalizePublishEvent(args.event);
    if (normalized.error) return textResult({ error: normalized.error }, true);
    const event = normalized.event;
    const subject = `neo.events.job.${event.job_id}.${event.type}`;
    nc.publish(subject, encoder.encode(JSON.stringify(event)));
    await nc.flush();
    return textResult({ published: true, subject, event });
  }
  return textResult({ error: `unknown tool: ${name}` }, true);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === "server/discover") {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    return;
  }
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {}, resources: { listChanged: false } }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } } });
    return;
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
    return;
  }
  if (method === "resources/list") {
    send({ jsonrpc: "2.0", id, result: { resources: [{ uri: PROGRESS_RESOURCE_URI, name: "Neo Job Progress", mimeType: PROGRESS_MIME_TYPE }] } });
    return;
  }
  if (method === "resources/read") {
    if (params?.uri !== PROGRESS_RESOURCE_URI) {
      send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown resource: ${params?.uri}` } });
      return;
    }
    send({
      jsonrpc: "2.0",
      id,
      result: {
        contents: [{
          uri: PROGRESS_RESOURCE_URI,
          mimeType: PROGRESS_MIME_TYPE,
          text: PROGRESS_HTML,
          _meta: { ui: { prefersBorder: true } },
        }],
      },
    });
    return;
  }
  if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
    return;
  }
  if (method === "tools/call") {
    try {
      send({ jsonrpc: "2.0", id, result: await callTool(params?.name, params?.arguments ?? {}) });
    } catch (error) {
      send({ jsonrpc: "2.0", id, result: textResult({ error: String(error?.message || error) }, true) });
    }
    return;
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
});

rl.on("close", async () => {
  try { await nc.drain(); } catch {}
  process.exit(0);
});
