import assert from "node:assert/strict";
import test from "node:test";
import { TOOLS, jsForTool } from "../server.mjs";

test("exports exact Computer Use tool names", () => {
  assert.deepEqual(TOOLS.map((tool) => tool.name), [
    "list_apps",
    "get_app_state",
    "click",
    "perform_secondary_action",
    "set_value",
    "select_text",
    "scroll",
    "drag",
    "press_key",
    "type_text",
  ]);
});

test("encodes parameters without eval", () => {
  const code = jsForTool("type_text", { app: "TextEdit", text: 'hello "world"' });
  assert.match(code, /sky\.type_text\(a\)/);
  assert.match(code, /hello \\"world\\"/);
  assert.doesNotMatch(code, /eval\(/);
});

test("get_app_state emits image plus accessibility text", () => {
  const code = jsForTool("get_app_state", { app: "TextEdit" });
  assert.match(code, /sky\.get_app_state\(a\)/);
  assert.match(code, /emitImage/);
  assert.match(code, /r\?\.text/);
});
