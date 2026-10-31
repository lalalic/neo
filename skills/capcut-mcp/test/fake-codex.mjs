#!/usr/bin/env node
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin });
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
const tools = [
  { name: "search_capcut_material", description: "Search materials", inputSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "capcut_video_generate", description: "Generate video using credits", inputSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false }, annotations: { readOnlyHint: false }, _meta: { ui: { resourceUri: "ui://capcut/demo", visibility: ["app"] }, "ui/resourceUri": "ui://capcut/demo", "openai/outputTemplate": "ui://capcut/demo", other: "preserved" } },
];
rl.on("line", line => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return;
  let result;
  switch (method) {
    case "initialize": result = { serverInfo: { name: "fake", version: "1" } }; break;
    case "mcpServerStatus/list": result = { data: [{ name: "capcut_creation", tools: Object.fromEntries(tools.map(t => [t.name, t])), toolsError: null }] }; break;
    case "thread/start": result = { thread: { id: "fake-thread" } }; break;
    case "mcpServer/tool/call":
      result = { content: [{ type: "text", text: JSON.stringify({ tool: params.tool, args: params.arguments }) }] };
      break;
    default: return send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Not found" } });
  }
  send({ jsonrpc: "2.0", id, result });
});
