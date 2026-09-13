import assert from "node:assert/strict";
import test from "node:test";
import { stripEmptyParentRunId, stripEmptyResumedFromRunId, stripTransientPermissionState } from "./run-normalize.ts";

test("stripEmptyParentRunId drops null and empty parent ids", () => {
  assert.deepEqual(stripEmptyParentRunId({ id: "a", parentRunId: "" }), { id: "a" });
  assert.deepEqual(stripEmptyParentRunId({ id: "b", parentRunId: null }), { id: "b" });
  assert.deepEqual(stripEmptyParentRunId({ id: "c" }), { id: "c" });
  assert.deepEqual(stripEmptyParentRunId({ id: "d", parentRunId: "parent" }), { id: "d", parentRunId: "parent" });
});

test("stripEmptyResumedFromRunId drops null and empty resume links", () => {
  assert.deepEqual(stripEmptyResumedFromRunId({ id: "a", resumedFromRunId: "" }), { id: "a" });
  assert.deepEqual(stripEmptyResumedFromRunId({ id: "b", resumedFromRunId: null }), { id: "b" });
  assert.deepEqual(stripEmptyResumedFromRunId({ id: "c" }), { id: "c" });
  assert.deepEqual(stripEmptyResumedFromRunId({ id: "d", resumedFromRunId: "prev" }), { id: "d", resumedFromRunId: "prev" });
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
