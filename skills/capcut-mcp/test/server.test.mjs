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

test("exactly one CapCut tool exposes help, forwards query, and guards writes", async () => {
  const h = harness();
  try {
    const init = await h.ask("initialize");
    assert.equal(init.result.protocolVersion, "2025-06-18");
    const list = await h.ask("tools/list");
    assert.equal(list.result.tools.length, 1);
    assert.equal(list.result.tools[0].name, "capcut");
    assert.equal(list.result.tools[0].inputSchema.properties.command.type, "string");
    const names = await h.ask("tools/call", { name: "capcut", arguments: { command: "help" } });
    const cmds = names.result.structuredContent.commands;
    assert.equal(cmds.length, 2);
    assert.equal(cmds.find(c => c.name === "search_capcut_material").readOnly, true);
    assert.equal(cmds.find(c => c.name === "capcut_video_generate").maySpendCredits, true);
    const details = await h.ask("tools/call", { name: "capcut", arguments: { command: "help", args: { command: "capcut_video_generate" } } });
    assert.deepEqual(details.result.structuredContent.inputSchema.required, ["prompt"]);
    assert.equal(details.result.structuredContent.needsApproval, true);
    const search = await h.ask("tools/call", { name: "capcut", arguments: { command: "search_capcut_material", args: { prompt: "Vlog" } } });
    assert.deepEqual(JSON.parse(search.result.content[0].text), {
      tool: "search_capcut_material", args: { prompt: "Vlog" },
    });
    const denied = await h.ask("tools/call", { name: "capcut", arguments: { command: "capcut_video_generate", args: { prompt: "Bicycle" } } });
    assert.equal(denied.result.isError, true);
    assert.match(denied.result.content[0].text, /Explicit user approval/);
    const allowed = await h.ask("tools/call", {
      name: "capcut", arguments: { command: "capcut_video_generate", args: { prompt: "Bicycle" }, confirm_capcut_change: true },
    });
    assert.deepEqual(JSON.parse(allowed.result.content[0].text), {
      tool: "capcut_video_generate", args: { prompt: "Bicycle" },
    });
    const wrong = await h.ask("tools/call", { name: "capcut", arguments: { command: "invalid" } });
    assert.equal(wrong.result.isError, true);
    const invalidArgs = await h.ask("tools/call", { name: "capcut", arguments: { command: "help", args: [] } });
    assert.equal(invalidArgs.result.isError, true);
    const wrongTool = await h.ask("tools/call", { name: "capcut_image_generate", arguments: {} });
    assert.equal(wrongTool.result.isError, true);
  } finally { h.close(); }
});
