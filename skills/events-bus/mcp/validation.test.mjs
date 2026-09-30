import test from "node:test";
import assert from "node:assert/strict";
import { safeJobId, safeTaskId } from "./validation.mjs";

test("job IDs remain transport-safe", () => {
  assert.equal(safeJobId("hourly_guardian-1"), true);
  assert.equal(safeJobId("[2026-09-29 17]"), false);
  assert.equal(safeJobId("job.with.dot"), false);
});

test("task IDs preserve durable literal identities", () => {
  assert.equal(safeTaskId("[2026-09-29 17]"), true);
  assert.equal(safeTaskId("task with spaces"), true);
  assert.equal(safeTaskId("task/child#1"), true);
});

test("task IDs must still be non-empty", () => {
  assert.equal(safeTaskId(""), false);
  assert.equal(safeTaskId("   "), false);
  assert.equal(safeTaskId(null), false);
});
