import assert from "node:assert/strict";
import test from "node:test";
import { MAX_RUNS_KEPT, capRunsOnLoad } from "./store-runs.ts";

test("capRunsOnLoad keeps the newest MAX_RUNS_KEPT rows", () => {
  const runs = Array.from({ length: MAX_RUNS_KEPT + 7 }, (_, i) => ({ id: i }));
  const capped = capRunsOnLoad(runs);
  assert.equal(capped.length, MAX_RUNS_KEPT);
  assert.equal(capped[0]?.id, 7);
  assert.equal(capped.at(-1)?.id, MAX_RUNS_KEPT + 6);
  assert.equal(capRunsOnLoad([{ id: 1 }]).length, 1);
});
