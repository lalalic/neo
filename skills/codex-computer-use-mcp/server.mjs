#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import os from "node:os";
import path from "node:path";

const CODEX = process.env.CODEX_COMPUTER_USE_MCP_CODEX || "/Applications/ChatGPT.app/Contents/Resources/codex";
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
const COMPUTER_USE_CWD = process.env.CODEX_COMPUTER_USE_MCP_CWD || path.join(CODEX_HOME, "computer-use");
const MODEL = process.env.CODEX_COMPUTER_USE_MCP_MODEL || "gpt-5.6-luna";
const EFFORT = process.env.CODEX_COMPUTER_USE_MCP_EFFORT || "low";
const SERVICE_TIER = process.env.CODEX_COMPUTER_USE_MCP_SERVICE_TIER || "priority";
const APP_SERVER_TIMEOUT_MS = Number(process.env.CODEX_COMPUTER_USE_MCP_TIMEOUT_MS || 45000);

const rw = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const mut = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const TOOLS = [
  { name: "list_apps", description: "List the apps on this computer. Returns the set of apps that are currently running, as well as any that have been used in the last 14 days, including details on usage frequency", inputSchema: { type: "object", additionalProperties: false, properties: {} }, annotations: rw },
  { name: "get_app_state", description: "Start an app use session if needed, then get the state of the app's key window and return a screenshot and accessibility tree. This must be called once per assistant turn before interacting with the app", inputSchema: { type: "object", additionalProperties: false, required: ["app"], properties: { app: { type: "string", description: "App name, full app path, or unambiguous bundle identifier" } } }, annotations: rw },
  { name: "click", description: "Click an element by index or pixel coordinates from screenshot", inputSchema: { type: "object", additionalProperties: false, required: ["app"], properties: { app: { type: "string", description: "App name, full app path, or unambiguous bundle identifier" }, element_index: { type: "string", description: "Element index to click" }, x: { type: "number", description: "X coordinate in screenshot pixel coordinates" }, y: { type: "number", description: "Y coordinate in screenshot pixel coordinates" }, mouse_button: { type: "string", enum: ["left", "right", "middle"], description: "Mouse button to click. Defaults to left." }, click_count: { type: "integer", description: "Number of clicks. Defaults to 1" } } }, annotations: mut },
  { name: "perform_secondary_action", description: "Invoke a secondary accessibility action exposed by an element", inputSchema: { type: "object", additionalProperties: false, required: ["app", "element_index", "action"], properties: { app: { type: "string", description: "App name, full app path, or unambiguous bundle identifier" }, element_index: { type: "string", description: "Element identifier" }, action: { type: "string", description: "Secondary accessibility action name" } } }, annotations: mut },
  { name: "set_value", description: "Set the value of a settable accessibility element", inputSchema: { type: "object", additionalProperties: false, required: ["app", "element_index", "value"], properties: { app: { type: "string", description: "App name, full app path, or unambiguous bundle identifier" }, element_index: { type: "string", description: "Element identifier" }, value: { type: "string", description: "Value to assign" } } }, annotations: mut },
  { name: "select_text", description: "Select text inside a text element, or place the text cursor before or after it. Provide text exactly as it appears in the accessibility tree, including any Markdown formatting. If the text is not unique, provide surrounding prefix or suffix text to disambiguate it.", inputSchema: { type: "object", additionalProperties: false, required: ["app", "element_index", "text"], properties: { app: { type: "string", description: "App name or bundle identifier" }, element_index: { type: "string", description: "Text element identifier" }, text: { type: "string", description: "Target text as shown in the accessibility tree" }, prefix: { type: "string" }, suffix: { type: "string" }, selection: { type: "string", enum: ["text", "cursor_before", "cursor_after"] } } }, annotations: mut },
  { name: "scroll", description: "Scroll an element in a direction by a number of pages", inputSchema: { type: "object", additionalProperties: false, required: ["app", "element_index", "direction"], properties: { app: { type: "string" }, element_index: { type: "string" }, direction: { type: "string" }, pages: { type: "number" } } }, annotations: mut },
  { name: "drag", description: "Drag from one point to another using pixel coordinates", inputSchema: { type: "object", additionalProperties: false, required: ["app", "from_x", "from_y", "to_x", "to_y"], properties: { app: { type: "string" }, from_x: { type: "number" }, from_y: { type: "number" }, to_x: { type: "number" }, to_y: { type: "number" } } }, annotations: mut },
  { name: "press_key", description: "Press a key or key-combination on the keyboard, including modifier and navigation keys.", inputSchema: { type: "object", additionalProperties: false, required: ["app", "key"], properties: { app: { type: "string" }, key: { type: "string" } } }, annotations: mut },
  { name: "type_text", description: "Type literal text using keyboard input", inputSchema: { type: "object", additionalProperties: false, required: ["app", "text"], properties: { app: { type: "string" }, text: { type: "string" } } }, annotations: mut }
];

const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));

function jsForTool(name, args) {
  const encoded = JSON.stringify(args || {});
  const prefix = 'var sky = globalThis.__codexComputerUseSky ??= (await import("@oai/sky")).sky; var a = ' + encoded + '; if (a.element_index != null) a.element_index = Number(a.element_index); if (a.selection != null) { a.selection_type = a.selection; delete a.selection; }';
  if (name === "list_apps") return prefix + ' var r = await sky.list_apps(a); nodeRepl.write(JSON.stringify(r));';
  if (name === "get_app_state") return prefix + ' var r = await sky.get_app_state(a); if (r?.screenshot?.url) await nodeRepl.emitImage(r.screenshot.url); nodeRepl.write(r?.text ?? r);';
  return prefix + ' await sky.' + name + '(a);';
}

class CodexAppServer {
  constructor() {
    this.child = null;
    this.rl = null;
    this.nextId = 1;
    this.pending = new Map();
    this.threadId = null;
    this.starting = null;
  }

  async start() {
    if (this.threadId && this.child && this.child.exitCode == null) return;
    if (this.starting) return this.starting;
    this.starting = this._start();
    try { await this.starting; } finally { this.starting = null; }
  }

  async _start() {
    this.child = spawn(CODEX, ["app-server", "--stdio"], {
      cwd: COMPUTER_USE_CWD,
      env: { ...process.env, CODEX_HOME },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => process.stderr.write("[codex-app-server] " + chunk));
    this.child.on("exit", (code, signal) => {
      const error = new Error("Codex app-server exited code=" + code + " signal=" + signal);
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(error);
      }
      this.pending.clear();
      this.threadId = null;
    });

    this.rl = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
    this.rl.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id == null) return;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else entry.resolve(message.result);
    });

    await this.request("initialize", { clientInfo: { name: "codex-computer-use-mcp", version: "0.1.0" } });
    const started = await this.request("thread/start", {
      cwd: COMPUTER_USE_CWD,
      model: MODEL,
      serviceTier: SERVICE_TIER,
      approvalPolicy: "never",
      sandbox: "danger-full-access",
      ephemeral: false,
      developerInstructions: "You are a deterministic Computer Use transport thread. If a model turn is ever used, call only the requested Computer Use/cua_repl operation with exactly the supplied parameters and emit only the tool output. Never reinterpret, broaden, or add extra UI actions.",
      config: { model_reasoning_effort: EFFORT },
      threadSource: "codex-computer-use-mcp"
    });
    this.threadId = started.thread.id;

    await this.callCuaJs('globalThis.__codexComputerUseSky ??= (await import("@oai/sky")).sky; nodeRepl.write("ready");', "warm Computer Use runtime");
  }

  request(method, params, timeoutMs) {
    timeoutMs = timeoutMs || APP_SERVER_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      if (!this.child || !this.child.stdin || !this.child.stdin.writable) {
        reject(new Error("Codex app-server stdin is not writable"));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Codex app-server " + method + " timed out after " + timeoutMs + "ms"));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  async callCuaJs(code, title) {
    if (!this.threadId) await this.start();
    return this.request("mcpServer/tool/call", {
      threadId: this.threadId,
      server: "cua_repl",
      tool: "js",
      arguments: { code, title }
    });
  }

  async callTool(name, args) {
    await this.start();
    const result = await this.callCuaJs(jsForTool(name, args), "Computer Use: " + name);
    const out = { content: Array.isArray(result && result.content) ? result.content : [] };
    if (result && result.structuredContent !== undefined) out.structuredContent = result.structuredContent;
    if (result && result.isError != null) out.isError = result.isError;
    return out;
  }

  stop() {
    if (this.rl) this.rl.close();
    if (this.child) this.child.kill("SIGTERM");
  }
}

function mcpError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
function mcpResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

const appServer = new CodexAppServer();
let callChain = Promise.resolve();

async function handle(message) {
  const id = message.id;
  const method = message.method;
  const params = message.params || {};
  if (method === "initialize") return mcpResult(id, { protocolVersion: params.protocolVersion || "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "codex-computer-use", version: "0.1.0" } });
  if (method === "notifications/initialized" || method === "initialized") return null;
  if (method === "ping") return mcpResult(id, {});
  if (method === "tools/list") return mcpResult(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params.name;
    if (!TOOL_NAMES.has(name)) return mcpError(id, -32602, "Unknown tool: " + String(name));
    const run = async () => {
      try {
        return mcpResult(id, await appServer.callTool(name, params.arguments || {}));
      } catch (error) {
        return mcpResult(id, { content: [{ type: "text", text: error && error.message ? error.message : String(error) }], isError: true });
      }
    };
    const pending = callChain.then(run, run);
    callChain = pending.then(() => undefined, () => undefined);
    return pending;
  }
  if (id == null) return null;
  return mcpError(id, -32601, "Method not found: " + method);
}

function runStdioServer() {
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on("line", async (line) => {
    let request;
    try { request = JSON.parse(line); }
    catch {
      process.stdout.write(JSON.stringify(mcpError(null, -32700, "Parse error")) + "\n");
      return;
    }
    try {
      const response = await handle(request);
      if (response) process.stdout.write(JSON.stringify(response) + "\n");
    } catch (error) {
      if (request && request.id != null) {
        process.stdout.write(JSON.stringify(mcpError(request.id, -32603, error && error.message ? error.message : String(error))) + "\n");
      }
    }
  });

  const shutdown = () => {
    appServer.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const isMain = process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href;
if (isMain) runStdioServer();

export { TOOLS, jsForTool, CodexAppServer, handle, runStdioServer };
