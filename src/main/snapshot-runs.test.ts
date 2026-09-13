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

test("recentRuns respects a custom limit and reuses at the exact boundary", () => {
  const runs = Array.from({ length: 5 }, (_, i) => ({ id: i }));
  assert.equal(recentRuns(runs, 5), runs);
  assert.deepEqual(recentRuns(runs, 2).map((r) => r.id), [3, 4]);
  assert.deepEqual(recentRuns(runs, 1).map((r) => r.id), [4]);
  // slice(-0) is slice(0) in JS, so limit 0 returns a full copy rather than [].
  const zero = recentRuns(runs, 0);
  assert.notEqual(zero, runs);
  assert.equal(zero.length, 5);
  assert.equal(SNAPSHOT_RUN_LIMIT, 120);
});
