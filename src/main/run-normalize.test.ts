import assert from "node:assert/strict";
import test from "node:test";
import { stripEmptyParentRunId, stripTransientPermissionState } from "./run-normalize.ts";

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


test("store load path strips empty parentRunId then transient permission fields", () => {
  // Mirrors Store.normalizeRun: stripEmptyParentRunId(stripTransientPermissionState(run))
  const loaded = stripEmptyParentRunId(
    stripTransientPermissionState({
      id: "r1",
      parentRunId: "",
      pendingPermission: { askId: "ask-x", toolCallId: "t", title: "rm", options: [] },
      pendingPermissionQueued: 3,
      status: "succeeded",
      eventCount: 2,
    }),
  );
  assert.deepEqual(loaded, { id: "r1", status: "succeeded", eventCount: 2 });
});

test("stripEmptyParentRunId keeps a real parent while permission strip still runs", () => {
  const loaded = stripEmptyParentRunId(
    stripTransientPermissionState({
      id: "child",
      parentRunId: "parent",
      pendingPermissionQueued: 1,
    }),
  );
  assert.deepEqual(loaded, { id: "child", parentRunId: "parent" });
});

test("stripEmptyParentRunId leaves nullish parent out so Boolean(parentRunId) stays false", () => {
  const cleared = stripEmptyParentRunId({ id: "x", parentRunId: null, agent: "cursor" });
  assert.equal("parentRunId" in cleared, false);
  assert.equal(Boolean((cleared as { parentRunId?: string }).parentRunId), false);
});
