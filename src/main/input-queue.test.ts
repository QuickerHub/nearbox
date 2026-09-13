import assert from "node:assert/strict";
import test from "node:test";
import { enqueueInputCommands, MAX_PENDING_INPUT_COMMANDS } from "./input-win.ts";

test("enqueueInputCommands drops the oldest when over capacity", () => {
  const pending = enqueueInputCommands([], ["a", "b", "c"], 2);
  assert.deepEqual(pending, ["b", "c"]);
  const more = enqueueInputCommands(["x"], ["y", "z"], 2);
  assert.deepEqual(more, ["y", "z"]);
  const empty = enqueueInputCommands(["keep"], [], 2);
  assert.deepEqual(empty, ["keep"]);
  assert.ok(MAX_PENDING_INPUT_COMMANDS >= 64);
});
