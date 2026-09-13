import assert from "node:assert/strict";
import test from "node:test";
import { recentRuns, SNAPSHOT_RUN_LIMIT } from "./snapshot-runs.ts";

test("recentRuns reuses the same array when under the snapshot limit", () => {
  const runs = Array.from({ length: 3 }, (_, i) => ({ id: String(i) }));
  assert.equal(recentRuns(runs), runs);
  assert.equal(recentRuns(runs, 3), runs);
});

test("recentRuns slices only when over the limit and keeps the tail", () => {
  const runs = Array.from({ length: SNAPSHOT_RUN_LIMIT + 5 }, (_, i) => ({ id: i }));
  const tail = recentRuns(runs);
  assert.notEqual(tail, runs);
  assert.equal(tail.length, SNAPSHOT_RUN_LIMIT);
  assert.equal(tail[0]?.id, 5);
  assert.equal(tail[tail.length - 1]?.id, SNAPSHOT_RUN_LIMIT + 4);
});
