import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const dir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
function harness() {
  const p = spawn(process.execPath, [resolve(dir, "server.mjs")], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, CAPCUT_CODEX_BIN: resolve(dir, "test/fake-codex.mjs"), CAPCUT_CODEX_HOME: "/tmp/mock-profile" },
  });
  const pending = new Map();
  const lines = readline.createInterface({ input: p.stdout });
  lines.on("line", line => {
    const msg = JSON.parse(line), item = pending.get(msg.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(msg.id);
    item.resolve(msg);
  });
  let id = 0;
  return {
    ask(method, params = {}) {
      const thisId = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Test timeout")), 8000);
        pending.set(thisId, { resolve, timer });
        p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: thisId, method, params }) + "\n");
      });
    },
    close() { p.stdin.end(); p.kill(); },
  };
}

test("MCP tools are discoverable, write operations gated, calls forwarded without gate", async () => {
  const h = harness();
  try {
    const init = await h.ask("initialize");
    assert.equal(init.result.protocolVersion, "2025-06-18");
    const list = await h.ask("tools/list");
    const tools = list.result.tools;
    assert.equal(tools.length, 2);
    const read = tools.find(t => t.name === "search_capcut_material");
    assert.equal(read.inputSchema.properties.confirm_capcut_change, undefined);
    const write = tools.find(t => t.name === "capcut_video_generate");
    assert.deepEqual(write.inputSchema.required, ["prompt", "confirm_capcut_change"]);
    assert.equal(write.inputSchema.properties.confirm_capcut_change.const, true);
    assert.match(write.description, /credit spend/);
    const search = await h.ask("tools/call", { name: "search_capcut_material", arguments: { prompt: "Vlog" } });
    const result = JSON.parse(search.result.content[0].text);
    assert.deepEqual(result, { tool: "search_capcut_material", args: { prompt: "Vlog" } });
    const denied = await h.ask("tools/call", { name: "capcut_video_generate", arguments: { prompt: "A bicycle" } });
    assert.equal(denied.result.isError, true);
    assert.match(denied.result.content[0].text, /Explicit user approval/);
    const allowed = await h.ask("tools/call", {
      name: "capcut_video_generate",
      arguments: { prompt: "A bicycle", confirm_capcut_change: true },
    });
    assert.deepEqual(JSON.parse(allowed.result.content[0].text), {
      tool: "capcut_video_generate", args: { prompt: "A bicycle" },
    });
    const unknown = await h.ask("tools/call", { name: "not-a-tool", arguments: {} });
    assert.equal(unknown.result.isError, true);
    assert.match(unknown.result.content[0].text, /Unknown/);
  } finally { h.close(); }
});
