import assert from "node:assert/strict";
import test from "node:test";
import { stripEmptyParentRunId } from "./run-normalize.ts";

test("stripEmptyParentRunId drops null and empty parent ids", () => {
  assert.deepEqual(stripEmptyParentRunId({ id: "a", parentRunId: "" }), { id: "a" });
  assert.deepEqual(stripEmptyParentRunId({ id: "b", parentRunId: null }), { id: "b" });
  assert.deepEqual(stripEmptyParentRunId({ id: "c" }), { id: "c" });
  assert.deepEqual(stripEmptyParentRunId({ id: "d", parentRunId: "parent" }), { id: "d", parentRunId: "parent" });
});
