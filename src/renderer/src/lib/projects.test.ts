import assert from "node:assert/strict";
import test from "node:test";
import { compareProjectsByRecency, mostRecentProject, projectRecency } from "./projects.ts";

test("projectRecency prefers lastUsedAt over createdAt", () => {
  assert.equal(projectRecency({ createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-09-01T00:00:00.000Z" }), Date.parse("2026-09-01T00:00:00.000Z"));
  assert.equal(projectRecency({ createdAt: "2026-01-01T00:00:00.000Z" }), Date.parse("2026-01-01T00:00:00.000Z"));
  assert.equal(projectRecency({ createdAt: "bogus" }), 0);
});

test("mostRecentProject picks without sorting", () => {
  const projects = [
    { id: "old", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "mid", createdAt: "2026-02-01T00:00:00.000Z", lastUsedAt: "2026-08-01T00:00:00.000Z" },
    { id: "new", createdAt: "2026-03-01T00:00:00.000Z", lastUsedAt: "2026-09-01T00:00:00.000Z" },
  ];
  assert.equal(mostRecentProject(projects)?.id, "new");
  assert.equal(mostRecentProject([]), undefined);
});

test("compareProjectsByRecency sorts newest first", () => {
  const projects = [
    { id: "a", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "b", createdAt: "2026-02-01T00:00:00.000Z", lastUsedAt: "2026-09-01T00:00:00.000Z" },
  ];
  const sorted = [...projects].sort(compareProjectsByRecency);
  assert.deepEqual(sorted.map((p) => p.id), ["b", "a"]);
});

test("compareProjectsByRecency is stable when timestamps match", () => {
  const a = { id: "a", createdAt: "2026-01-01T00:00:00.000Z" };
  const b = { id: "b", createdAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(compareProjectsByRecency(a, b), 0);
  assert.equal(projectRecency({ createdAt: "bogus", lastUsedAt: "also-bogus" }), 0);
  assert.equal(projectRecency({ createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "bogus" }), 0, "invalid lastUsedAt does not fall back");
});
