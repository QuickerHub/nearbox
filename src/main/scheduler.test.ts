import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRun } from "../shared/protocol.ts";
import { activeDescendants, nextRunnable } from "./scheduler.ts";

const actor = { id: "desktop", name: "PC", role: "desktop" as const };

function run(id: string, overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id,
    taskId: "t1",
    projectId: "p1",
    agent: "cursor",
    access: "full",
    prompt: "x",
    cwd: "D:\\x",
    status: "queued",
    requestedBy: actor,
    createdAt: "2026-09-07T00:00:00.000Z",
    eventCount: 0,
    ...overrides,
  };
}

test("one run per project: a queued run waits for the running one", () => {
  const runs = [run("a", { status: "running" }), run("b")];
  assert.equal(nextRunnable(runs, 4), undefined);
});

test("a different project starts when the limit allows", () => {
  const runs = [run("a", { status: "running" }), run("b", { projectId: "p2" })];
  assert.equal(nextRunnable(runs, 2)?.id, "b");
  assert.equal(nextRunnable(runs, 1), undefined);
});

test("a sub-run may start in the project its waiting parent holds", () => {
  const runs = [run("parent", { status: "running" }), run("child", { parentRunId: "parent", agent: "grok" })];
  assert.equal(nextRunnable(runs, 1)?.id, "child");
});

test("the waiting parent holds no concurrency slot, but the running child does", () => {
  const runs = [run("parent", { status: "running" }), run("child", { status: "running", parentRunId: "parent" }), run("other", { projectId: "p2" })];
  assert.equal(nextRunnable(runs, 1), undefined);
  assert.equal(nextRunnable(runs, 2)?.id, "other");
});

test("a follow-up queued behind the parent does not slip in while it waits", () => {
  const runs = [
    run("parent", { status: "running" }),
    run("follow-up", { resumedFromRunId: "parent" }),
    run("child", { parentRunId: "parent", agent: "claude" }),
  ];
  assert.equal(nextRunnable(runs, 4)?.id, "child");
});

test("two sub-runs of one parent in the same project take turns", () => {
  const runs = [
    run("parent", { status: "running" }),
    run("child-1", { status: "running", parentRunId: "parent" }),
    run("child-2", { parentRunId: "parent" }),
  ];
  assert.equal(nextRunnable(runs, 4), undefined);
});

test("a grandchild may start while both ancestors wait", () => {
  const runs = [
    run("parent", { status: "running" }),
    run("child", { status: "running", parentRunId: "parent" }),
    run("grandchild", { parentRunId: "child" }),
  ];
  assert.equal(nextRunnable(runs, 1)?.id, "grandchild");
});

test("a finished parent no longer frees anything", () => {
  const runs = [run("parent", { status: "succeeded" }), run("other", { status: "running" }), run("child", { parentRunId: "parent" })];
  assert.equal(nextRunnable(runs, 4), undefined);
});

test("activeDescendants follows the chain and skips finished runs", () => {
  const runs = [
    run("parent", { status: "running" }),
    run("child", { status: "running", parentRunId: "parent" }),
    run("grandchild", { parentRunId: "child" }),
    run("done", { status: "succeeded", parentRunId: "parent" }),
    run("unrelated", { status: "running", projectId: "p2" }),
  ];
  assert.deepEqual(
    activeDescendants(runs, "parent").map((item) => item.id),
    ["child", "grandchild"],
  );
});
