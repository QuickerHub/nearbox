import assert from "node:assert/strict";
import test from "node:test";
import { MAX_NOTES_PER_TASK, capNotesTail } from "./store-notes.ts";

test("capNotesTail keeps the newest notes within the ceiling", () => {
  assert.deepEqual(capNotesTail([1, 2, 3], 2), [2, 3]);
  assert.deepEqual(capNotesTail([1, 2], 10), [1, 2]);
  assert.deepEqual(capNotesTail([], 5), []);
  assert.equal(capNotesTail(Array.from({ length: MAX_NOTES_PER_TASK + 3 }, (_, i) => i)).length, MAX_NOTES_PER_TASK);
  assert.deepEqual(capNotesTail(null as unknown as number[]), []);
  assert.deepEqual(capNotesTail([1], 0), []);
});
