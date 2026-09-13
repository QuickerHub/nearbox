import assert from "node:assert/strict";
import test from "node:test";
import { coerceTaskStatus } from "./store-task-status.ts";

test("coerceTaskStatus keeps known statuses and fails closed otherwise", () => {
  assert.equal(coerceTaskStatus("todo"), "todo");
  assert.equal(coerceTaskStatus("done"), "done");
  assert.equal(coerceTaskStatus("DOING"), "inbox");
  assert.equal(coerceTaskStatus(null), "inbox");
  assert.equal(coerceTaskStatus(1), "inbox");
  assert.equal(coerceTaskStatus(""), "inbox");
});
