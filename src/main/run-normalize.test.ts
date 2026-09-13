import assert from "node:assert/strict";
import test from "node:test";
import { coerceEventCount, stripEmptyParentRunId, stripTransientPermissionState } from "./run-normalize.ts";

test("stripEmptyParentRunId drops null and empty parent ids", () => {
  assert.deepEqual(stripEmptyParentRunId({ id: "a", parentRunId: "" }), { id: "a" });
  assert.deepEqual(stripEmptyParentRunId({ id: "b", parentRunId: null }), { id: "b" });
  assert.deepEqual(stripEmptyParentRunId({ id: "c" }), { id: "c" });
  assert.deepEqual(stripEmptyParentRunId({ id: "d", parentRunId: "parent" }), { id: "d", parentRunId: "parent" });
});

test("stripTransientPermissionState drops pending ask and queued count", () => {
  assert.deepEqual(
    stripTransientPermissionState({
      id: "a",
      pendingPermission: { toolCallId: "t", askId: "ask-t", title: "x", options: [] },
      pendingPermissionQueued: 2,
      status: "running",
    }),
    { id: "a", status: "running" },
  );
  assert.deepEqual(stripTransientPermissionState({ id: "b", pendingPermissionQueued: 1 }), { id: "b" });
  assert.deepEqual(stripTransientPermissionState({ id: "c" }), { id: "c" });
});

test("coerceEventCount rejects NaN/Infinity/negatives and floors", () => {
  assert.equal(coerceEventCount(undefined), 0);
  assert.equal(coerceEventCount(null), 0);
  assert.equal(coerceEventCount(Number.NaN), 0);
  assert.equal(coerceEventCount(Number.POSITIVE_INFINITY), 0);
  assert.equal(coerceEventCount(-3), 0);
  assert.equal(coerceEventCount(2.9), 2);
  assert.equal(coerceEventCount("12"), 12);
  assert.equal(coerceEventCount("nope"), 0);
});

