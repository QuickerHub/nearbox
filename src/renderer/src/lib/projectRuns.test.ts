import assert from "node:assert/strict";
import test from "node:test";
import { countProjectRuns } from "./projectRuns.ts";

test("countProjectRuns tallies active and total in one pass", () => {
  const runs = [
    { projectId: "p1", status: "running" as const },
    { projectId: "p1", status: "queued" as const },
    { projectId: "p1", status: "succeeded" as const },
    { projectId: "p2", status: "running" as const },
  ];
  assert.deepEqual(countProjectRuns(runs, "p1"), { active: 2, total: 3 });
  assert.deepEqual(countProjectRuns(runs, "p2"), { active: 1, total: 1 });
  assert.deepEqual(countProjectRuns(runs, "missing"), { active: 0, total: 0 });
});
