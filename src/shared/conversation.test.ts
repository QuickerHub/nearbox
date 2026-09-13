import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRun } from "./protocol.ts";
import { canContinueRun, countActiveRuns, hasParentRunId, isTopLevelActiveRun, sessionIdAlongChain } from "./conversation.ts";

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
    status: "succeeded",
    requestedBy: actor,
    createdAt: "2026-09-07T00:00:00.000Z",
    eventCount: 0,
    ...overrides,
  };
}

test("sessionIdAlongChain returns the newest session walking resumedFromRunId", () => {
  const runs = [
    run("a", { sessionId: "sess-a" }),
    run("b", { resumedFromRunId: "a" }),
    run("c", { resumedFromRunId: "b", sessionId: "sess-c" }),
  ];
  assert.equal(sessionIdAlongChain(runs, "c"), "sess-c");
  assert.equal(sessionIdAlongChain(runs, "b"), "sess-a");
  assert.equal(sessionIdAlongChain(runs, "missing"), undefined);
});

test("sessionIdAlongChain stops on cycles and missing links", () => {
  const runs = [run("a", { resumedFromRunId: "b" }), run("b", { resumedFromRunId: "a" })];
  assert.equal(sessionIdAlongChain(runs, "a"), undefined);
  assert.equal(sessionIdAlongChain(runs, undefined), undefined);
});

test("canContinueRun is true for active turns and for finished turns with a session", () => {
  const withSession = run("a", { sessionId: "sess" });
  const active = run("b", { status: "running" });
  const dead = run("c");
  const followUp = run("d", { status: "failed", resumedFromRunId: "a" });
  const runs = [withSession, active, dead, followUp];
  assert.equal(canContinueRun(runs, withSession), true);
  assert.equal(canContinueRun(runs, active), true);
  assert.equal(canContinueRun(runs, dead), false);
  assert.equal(canContinueRun(runs, followUp), true);
});

test("isTopLevelActiveRun ignores delegated children", () => {
  assert.equal(isTopLevelActiveRun(run("parent", { status: "running" })), true);
  assert.equal(isTopLevelActiveRun(run("queued", { status: "queued" })), true);
  assert.equal(isTopLevelActiveRun(run("done", { status: "succeeded" })), false);
  assert.equal(isTopLevelActiveRun(run("child", { status: "running", parentRunId: "parent" })), false);
  // null/empty mean "no parent" (top-level), matching plan/taskList `!parentRunId`
  assert.equal(isTopLevelActiveRun(run("nullish", { status: "running", parentRunId: null as unknown as string })), true);
  assert.equal(isTopLevelActiveRun(run("empty", { status: "running", parentRunId: "" })), true);
});

test("hasParentRunId treats null/empty like missing", () => {
  assert.equal(hasParentRunId(run("top")), false);
  assert.equal(hasParentRunId(run("child", { parentRunId: "parent" })), true);
  assert.equal(hasParentRunId(run("nullish", { parentRunId: null as unknown as string })), false);
  assert.equal(hasParentRunId(run("empty", { parentRunId: "" })), false);
});

test("countActiveRuns tallies queued and running", () => {
  assert.equal(countActiveRuns([]), 0);
  assert.equal(
    countActiveRuns([
      run("a", { status: "running" }),
      run("b", { status: "queued" }),
      run("c", { status: "succeeded" }),
      run("d", { status: "running" }),
    ]),
    3,
  );
});
