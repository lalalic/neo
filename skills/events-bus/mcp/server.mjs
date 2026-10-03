#!/usr/bin/env node
import readline from "node:readline";
import fs from "node:fs";
import { JOB_ID_PATTERN } from "./validation.mjs";
import { createEventsBusCore, MAX_WAIT_MS } from "../core/events-core.mjs";

const SERVER_NAME = "events-bus-mcp";
const SERVER_VERSION = "0.2.0";
const PROGRESS_RESOURCE_URI = "ui://events-bus/job-progress-v1.html";
const PROGRESS_MIME_TYPE = "text/html;profile=mcp-app";
const PROGRESS_HTML = fs.readFileSync(new URL("./job-progress.html", import.meta.url), "utf8");
const core = createEventsBusCore({ name: SERVER_NAME });

function structuredResult(value) { return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value }; }
function textResult(value, isError = false) { return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) }; }

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
            job_id: { type: "string", pattern: JOB_ID_PATTERN, description: "Use the caller-provided literal job_id; never use placeholders such as inherited/current." },
            task_id: { type: "string", minLength: 1, description: "Use the caller-provided literal task_id; task IDs are payload correlation values and are not restricted to NATS-safe job ID characters." },
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

async function callTool(name, args = {}) {
  try {
    if (name === "health") return textResult(await core.health());
    if (name === "watch") return textResult(await core.watch(args.job_id));
    if (name === "history") return textResult(core.history(args.job_id, args.after_cursor ?? 0, args.limit ?? 100));
    if (name === "wait") return textResult(await core.wait(args.job_id, args.after_cursor ?? 0, args.timeout_ms ?? 25_000, args.limit ?? 100));
    if (name === "status") return textResult(core.status(args.job_id));
    if (name === "progress") return structuredResult(core.progress(args.job_id));
    if (name === "publish") return textResult(await core.publish(args.event, { agent: "mcp" }));
    return textResult({ error: `unknown tool: ${name}` }, true);
  } catch (error) { return textResult({ error: String(error?.message || error) }, true); }
}

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (method === "server/discover") return send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  if (method === "initialize") return send({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {}, resources: { listChanged: false } }, serverInfo: { name: SERVER_NAME, version: SERVER_VERSION } } });
  if (method === "notifications/initialized" || method === "notifications/cancelled") return;
  if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
  if (method === "resources/list") return send({ jsonrpc: "2.0", id, result: { resources: [{ uri: PROGRESS_RESOURCE_URI, name: "Neo Job Progress", mimeType: PROGRESS_MIME_TYPE }] } });
  if (method === "resources/read") {
    if (params?.uri !== PROGRESS_RESOURCE_URI) return send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown resource: ${params?.uri}` } });
    return send({ jsonrpc: "2.0", id, result: { contents: [{ uri: PROGRESS_RESOURCE_URI, mimeType: PROGRESS_MIME_TYPE, text: PROGRESS_HTML, _meta: { ui: { prefersBorder: true } } }] } });
  }
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "tools/call") return send({ jsonrpc: "2.0", id, result: await callTool(params?.name, params?.arguments ?? {}) });
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
});
rl.on("close", async () => { await core.close(); process.exit(0); });
