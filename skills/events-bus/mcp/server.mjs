#!/usr/bin/env node
import readline from "node:readline";
import { createEventsBusCore } from "../core/events-core.mjs";

const SERVER_NAME = "events-bus-mcp";
const SERVER_VERSION = "0.2.0";
const core = createEventsBusCore({ name: SERVER_NAME });

function structuredResult(value) { return { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value }; }
function textResult(value, isError = false) { return { content: [{ type: "text", text: JSON.stringify(value) }], ...(isError ? { isError: true } : {}) }; }
function diagnoseFailure(name,args,reason,stage){
  process.stderr.write(JSON.stringify({component:"events-bus-mcp",operation:name,stage,error:String(reason).slice(0,300)})+"\n");
}

const TOOLS = [{
  name: "publish",
  description: "Publish an event with type, source, and opaque object data. Follow the producer and consumer protocol for source identity, business fields and terminal events.",
  inputSchema: {
    type: "object",
    properties: {
      type: { type: "string", pattern: "^[A-Za-z0-9_.-]+$" },
      source: { type: "string", description: "Producer-defined routing identity" },
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
    const result = await core.publish(args);
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
