import assert from "node:assert/strict";
import test from "node:test";
import { countAllProjectRuns, countProjectRuns, projectRunCount } from "./projectRuns.ts";

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

test("countAllProjectRuns walks every project once", () => {
  const runs = [
    { projectId: "p1", status: "running" as const },
    { projectId: "p1", status: "queued" as const },
    { projectId: "p1", status: "succeeded" as const },
    { projectId: "p2", status: "running" as const },
  ];
  const counts = countAllProjectRuns(runs);
  assert.deepEqual(projectRunCount(counts, "p1"), { active: 2, total: 3 });
  assert.deepEqual(projectRunCount(counts, "p2"), { active: 1, total: 1 });
  assert.deepEqual(projectRunCount(counts, "missing"), { active: 0, total: 0 });
  assert.deepEqual(countProjectRuns(runs, "p1"), projectRunCount(counts, "p1"));
});
