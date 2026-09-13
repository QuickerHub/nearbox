import assert from "node:assert/strict";
import test from "node:test";
import { coerceTaskPriority } from "./store-priority.ts";

test("coerceTaskPriority keeps high and fails closed to normal", () => {
  assert.equal(coerceTaskPriority("high"), "high");
  assert.equal(coerceTaskPriority("normal"), "normal");
  assert.equal(coerceTaskPriority("HIGH"), "normal");
  assert.equal(coerceTaskPriority(null), "normal");
  assert.equal(coerceTaskPriority(undefined), "normal");
  assert.equal(coerceTaskPriority(1), "normal");
});
