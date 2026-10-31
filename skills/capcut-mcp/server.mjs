#!/usr/bin/env node
// A local, credential-free MCP facade over CapCut's authenticated Codex app-server transport.
// Codex owns OAuth and tokens in a private CODEX_HOME; only tool schemas/results cross this bridge.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

const NAME = "capcut-neo-bridge";
const VERSION = "0.1.0";
const SERVER = "capcut_creation";
const TOOL_TIMEOUT_MS = Number(process.env.CAPCUT_TOOL_TIMEOUT_MS || 180000);
const HOME = process.env.CAPCUT_CODEX_HOME || join(homedir(), ".local/share/neo/capcut-mcp-client");
const CODEX = process.env.CAPCUT_CODEX_BIN || join(homedir(), ".local/bin/codex");
const CATALOG_TTL_MS = 120000;

class AppServer {
  constructor() {
    this.child = null;
    this.nextId = 0;
    this.pending = new Map();
    this.starting = null;
    this.catalog = null;
    this.catalogAt = 0;
    this.threadId = null;
  }
  start() {
    if (this.starting) return this.starting;
    this.starting = this.initialize().catch(e => {
      this.child?.kill();
      this.child = null;
      this.starting = null;
      throw e;
    });
    return this.starting;
  }
  async initialize() {
    const child = spawn(CODEX, ["app-server", "--stdio"], {
      env: { ...process.env, CODEX_HOME: HOME },
      stdio: ["pipe", "pipe", "ignore"],
    });
    this.child = child;
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", line => {
      let msg;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg.id === undefined) return;
      const req = this.pending.get(msg.id);
      if (!req) return;
      this.pending.delete(msg.id);
      clearTimeout(req.timer);
      if (msg.error) req.reject(new Error(String(msg.error.message || JSON.stringify(msg.error))));
      else req.resolve(msg.result);
    });
    child.on("error", e => { this.failPending(e); });
    child.on("exit", () => {
      this.failPending(new Error("CapCut transport exited"));
      this.child = null;
      this.starting = null;
      this.catalog = null;
      this.threadId = null;
    });
    await this.request("initialize", {
      clientInfo: { name: NAME, title: "Neo CapCut MCP", version: VERSION },
      capabilities: {},
    }, 30000);
    this.notify("initialized");
  }
  failPending(error) {
    for (const req of this.pending.values()) {
      clearTimeout(req.timer);
      req.reject(error);
    }
    this.pending.clear();
  }
  notify(method, params) {
    this.child?.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) }) + "\n");
  }
  request(method, params, timeout = TOOL_TIMEOUT_MS) {
    if (!this.child || !this.child.stdin.writable) return Promise.reject(new Error("CapCut transport unavailable"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CapCut call timed out: ${method}`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n", error => {
        if (error && this.pending.has(id)) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(error);
        }
      });
    });
  }
  async list() {
    await this.start();
    if (this.catalog && Date.now() - this.catalogAt < CATALOG_TTL_MS) return this.catalog;
    const response = await this.request("mcpServerStatus/list",
      { serverName: SERVER, detail: "full" }, 35000);
    const found = response?.data?.find(s => s.name === SERVER);
    if (!found || found.toolsError) throw new Error(found?.toolsError || "CapCut MCP is not registered");
    if (!found.tools || !Object.keys(found.tools).length) throw new Error("CapCut MCP tool catalog empty");
    this.catalog = Object.values(found.tools);
    this.catalogAt = Date.now();
    return this.catalog;
  }
  async invoke(name, args) {
    const catalog = await this.list();
    if (!catalog.some(t => t.name === name)) throw new Error("Unknown CapCut tool");
    if (!this.threadId) {
      const response = await this.request("thread/start", { cwd: homedir(), ephemeral: true }, 30000);
      this.threadId = response?.thread?.id;
      if (!this.threadId) throw new Error("Could not create temporary CapCut invocation session");
    }
    return this.request("mcpServer/tool/call", {
      threadId: this.threadId, server: SERVER, tool: name, arguments: args,
    });
  }
  close() {
    this.failPending(new Error("Bridge shutdown"));
    if (this.child && !this.child.killed) this.child.kill();
  }
}

const app = new AppServer();
const creditTools = new Set(["capcut_video_generate", "capcut_image_generate"]);
function exposedTool(tool) {
  const mutation = tool.annotations?.readOnlyHint !== true;
  if (!mutation) return tool;
  // Keep CapCut's original schema strict: remove this local gate before invoking the remote tool.
  const schema = tool.inputSchema || { type: "object", properties: {} };
  if (schema.type !== "object") return tool;
  const props = { ...schema.properties, confirm_capcut_change: {
    type: "boolean",
    const: true,
    description: creditTools.has(tool.name)
      ? "Set true only after the user explicitly authorizes this generation and any CapCut credit cost."
      : "Set true only when the user explicitly authorizes this CapCut operation.",
  } };
  return {
    ...tool,
    description: `${tool.description || ""}\nNeo safety gate: user approval is required for this operation${creditTools.has(tool.name) ? " and any credit spend" : ""}.`,
    inputSchema: { ...schema, properties: props,
      required: [...new Set([...(schema.required || []), "confirm_capcut_change"])] },
  };
}
function mcpError(message) {
  return { content: [{ type: "text", text: String(message) }], isError: true };
}
function send(reply) { process.stdout.write(JSON.stringify(reply) + "\n"); }
async function handle(msg) {
  const { id, method, params = {} } = msg;
  if (id === undefined) return;
  const ok = result => send({ jsonrpc: "2.0", id, result });
  const error = (code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });
  try {
    if (method === "initialize") return ok({
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: NAME, version: VERSION },
    });
    if (method === "ping") return ok({});
    if (method === "resources/list") return ok({ resources: [] });
    if (method === "tools/list") {
      const tools = await app.list();
      return ok({ tools: tools.map(exposedTool) });
    }
    if (method === "tools/call") {
      const name = params.name;
      const tool = (await app.list()).find(t => t.name === name);
      if (!tool) return ok(mcpError("Unknown CapCut tool"));
      const args = { ...(params.arguments || {}) };
      if (tool.annotations?.readOnlyHint !== true) {
        if (args.confirm_capcut_change !== true) {
          return ok(mcpError("Explicit user approval required before this CapCut operation; credit-consuming generation additionally requires user approval of the estimated cost."));
        }
        delete args.confirm_capcut_change;
      }
      const result = await app.invoke(name, args);
      return ok(result || mcpError("CapCut returned an empty tool response"));
    }
    return error(-32601, "Method not found");
  } catch (e) {
    if (method === "tools/call") return ok(mcpError(e.message || "CapCut MCP invocation failed"));
    return error(-32603, e.message || "CapCut MCP unavailable");
  }
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === "notifications/initialized" || msg.method === "notifications/cancelled") return;
  void handle(msg);
});
rl.on("close", () => { app.close(); process.exit(0); });
process.on("SIGTERM", () => { app.close(); process.exit(0); });
