import assert from "node:assert/strict";
import test from "node:test";
import { stripEmptyParentRunId, stripEmptySessionId, stripTransientPermissionState } from "./run-normalize.ts";

test("stripEmptyParentRunId drops null and empty parent ids", () => {
  assert.deepEqual(stripEmptyParentRunId({ id: "a", parentRunId: "" }), { id: "a" });
  assert.deepEqual(stripEmptyParentRunId({ id: "b", parentRunId: null }), { id: "b" });
  assert.deepEqual(stripEmptyParentRunId({ id: "c" }), { id: "c" });
  assert.deepEqual(stripEmptyParentRunId({ id: "d", parentRunId: "parent" }), { id: "d", parentRunId: "parent" });
});

test("stripEmptySessionId drops null/empty/whitespace and trims padded ids", () => {
  assert.deepEqual(stripEmptySessionId({ id: "a", sessionId: "" }), { id: "a" });
  assert.deepEqual(stripEmptySessionId({ id: "b", sessionId: null }), { id: "b" });
  assert.deepEqual(stripEmptySessionId({ id: "c", sessionId: "   " }), { id: "c" });
  assert.deepEqual(stripEmptySessionId({ id: "d", sessionId: "  abc  " }), { id: "d", sessionId: "abc" });
  assert.deepEqual(stripEmptySessionId({ id: "e", sessionId: "sess-1" }), { id: "e", sessionId: "sess-1" });
  assert.deepEqual(stripEmptySessionId({ id: "f" }), { id: "f" });
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
