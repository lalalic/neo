#!/usr/bin/env node
import readline from "node:readline";
import { createEventsBusCore } from "../core/events-core.mjs";
import { expandPublishEvent } from "../core/publish-envelope.mjs";

const SERVER_NAME = "events-bus-mcp";
const SERVER_VERSION = "0.2.0";
const core = createEventsBusCore({ name: SERVER_NAME });

function structuredResult(value) { return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value }; }
function textResult(value, isError = false) { return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) }; }
// Relay stores job IDs as integers; the core and NATS subjects use canonical strings.
function normalizeJobId(value) {
  if (Number.isSafeInteger(value) && value >= 0) return String(value);
  return value;
}
function resultOrError(name, args, result) {
  if (result?.error) diagnoseFailure(name, args, result.error, "validation");
  return textResult(result, Boolean(result?.error));
}
function diagnoseFailure(name, args, reason, stage) {
  // No event payloads or message bodies in diagnostic logs.
  const id = name === "publish" ? args?.event?.job_id : args?.job_id;
  const diagnostic = { component: "events-bus-mcp", operation: name, stage,
    job_id_type: id === null ? "null" : typeof id,
    error: String(reason).slice(0, 300) };
  process.stderr.write(`[events-bus] ${JSON.stringify(diagnostic)}\n`);
}

const TOOLS = [{
  name: "publish",
  description: "Publish a lifecycle event. source identifies job/task/execution; data contains the business result.",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", pattern: "^[A-Za-z0-9_.-]+$" },
      source: { type: "string", description: "job/<job-id>/task/<task-id>/execution/<execution-id>" },
      data: { type: "object" },
    },
    required: ["type", "source"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, idempotentHint: false },
}];

async function callTool(name, args = {}) {
  if (name !== 'publish') return textResult({ error: `unknown tool: ${name}` }, true);
  try {
    const result = await core.publish(expandPublishEvent(args), { agent: 'mcp' });
    return textResult(result);
  } catch (error) {
    diagnoseFailure(name, args, error?.message || error, 'execution');
    return textResult({ error: String(error?.message || error) }, true);
  }
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
  if (method === "resources/list") return send({ jsonrpc: "2.0", id, result: { resources: [] } });
  if (method === "resources/read") return send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown resource: ${params?.uri}` } });
  if (method === "tools/list") return send({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
  if (method === "tools/call") return send({ jsonrpc: "2.0", id, result: await callTool(params?.name, params?.arguments ?? {}) });
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
});
rl.on("close", async () => { await core.close(); process.exit(0); });
