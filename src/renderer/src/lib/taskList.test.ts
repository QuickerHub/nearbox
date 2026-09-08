import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRun, Project, Task } from "../../../shared/protocol.ts";
import { activeRuns, activityLabel, attentionFor, buildSections, latestTurns, rowAgent, rowState, seenMarker, updateSeen } from "./taskList.ts";

const actor = { id: "desktop", name: "PC", role: "desktop" as const };

function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: overrides.id,
    details: "",
    status: "todo",
    priority: "normal",
    createdBy: actor,
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
    notes: [],
    ...overrides,
  };
}

function run(overrides: Partial<AgentRun> & { id: string; taskId: string }): AgentRun {
  return {
    projectId: "p1",
    agent: "cursor",
    access: "safe",
    prompt: "x",
    cwd: "D:\\x",
    status: "succeeded",
    requestedBy: actor,
    createdAt: "2026-09-06T00:00:00.000Z",
    finishedAt: "2026-09-06T00:01:00.000Z",
    eventCount: 1,
    ...overrides,
  };
}

function project(id: string, name = id): Project {
  return { id, name, path: `D:\\${name}`, createdAt: "2026-09-01T00:00:00.000Z" };
}

test("latest turn per task ignores delegated sub-runs", () => {
  const runs = [
    run({ id: "r1", taskId: "t1" }),
    run({ id: "r2", taskId: "t1", status: "running", finishedAt: undefined }),
    run({ id: "r3", taskId: "t1", parentRunId: "r2", agent: "grok", status: "running", finishedAt: undefined }),
  ];
  assert.equal(latestTurns(runs).get("t1")?.id, "r2");
});

test("the active run of a task prefers running over queued and the task's own turn over a sub-run", () => {
  const runs = [
    run({ id: "child", taskId: "t1", parentRunId: "parent", status: "running", agent: "grok" }),
    run({ id: "parent", taskId: "t1", status: "running" }),
    run({ id: "later", taskId: "t1", status: "queued" }),
    run({ id: "q", taskId: "t2", status: "queued" }),
    run({ id: "old", taskId: "t3" }),
  ];
  const active = activeRuns(runs);
  assert.equal(active.get("t1")?.id, "parent");
  assert.equal(active.get("t2")?.id, "q");
  assert.equal(active.has("t3"), false);
});

test("a turn waiting for permission needs the user, even on a delegated sub-run", () => {
  const tasks = [task({ id: "t1" })];
  const runs = [
    run({ id: "parent", taskId: "t1", status: "running", finishedAt: undefined }),
    run({
      id: "child",
      taskId: "t1",
      parentRunId: "parent",
      agent: "codex",
      status: "running",
      finishedAt: undefined,
      pendingPermission: { toolCallId: "c1", title: "npm test", options: [] },
    }),
  ];
  const items = attentionFor(tasks, runs, {});
  assert.equal(items.length, 1);
  assert.equal(items[0]?.reason, "permission");
  assert.equal(items[0]?.run.id, "child");
});

test("a finished turn is news until the task is opened; cancelled and done are not", () => {
  const tasks = [task({ id: "ok" }), task({ id: "bad" }), task({ id: "stopped" }), task({ id: "closed", status: "done" }), task({ id: "busy" })];
  const runs = [
    run({ id: "r-ok", taskId: "ok" }),
    run({ id: "r-bad", taskId: "bad", status: "failed", finishedAt: "2026-09-06T00:02:00.000Z" }),
    run({ id: "r-stopped", taskId: "stopped", status: "cancelled" }),
    run({ id: "r-closed", taskId: "closed" }),
    run({ id: "r-busy", taskId: "busy", status: "running", finishedAt: undefined }),
  ];
  const items = attentionFor(tasks, runs, {});
  assert.deepEqual(
    items.map((item) => [item.task.id, item.reason]),
    [
      ["bad", "failed"],
      ["ok", "finished"],
    ],
  );
  const seen = { ok: seenMarker(runs[0]), bad: seenMarker(runs[1]) };
  assert.deepEqual(attentionFor(tasks, runs, seen), []);
  // The same turn finishing later changes the marker, so it is news again.
  const stale = { ok: "r-ok|running" };
  assert.equal(attentionFor(tasks, runs, stale).some((item) => item.task.id === "ok"), true);
});

test("attention is ordered permission, failed, finished, newest first within each", () => {
  const tasks = [task({ id: "a" }), task({ id: "b" }), task({ id: "c" }), task({ id: "d" })];
  const runs = [
    run({ id: "ra", taskId: "a", finishedAt: "2026-09-06T00:01:00.000Z" }),
    run({ id: "rb", taskId: "b", finishedAt: "2026-09-06T00:05:00.000Z" }),
    run({ id: "rc", taskId: "c", status: "failed" }),
    run({ id: "rd", taskId: "d", status: "running", finishedAt: undefined, pendingPermission: { toolCallId: "x", title: "rm", options: [] } }),
  ];
  assert.deepEqual(
    attentionFor(tasks, runs, {}).map((item) => item.task.id),
    ["d", "c", "b", "a"],
  );
});

test("the first seen map treats every existing turn as seen; later only the open task is marked", () => {
  const tasks = [task({ id: "t1" }), task({ id: "t2" })];
  const runs = [run({ id: "r1", taskId: "t1" })];
  const first = updateSeen(null, tasks, runs, undefined);
  assert.deepEqual(first, { t1: "r1|succeeded", t2: "" });

  const unchanged = updateSeen(first, tasks, runs, undefined);
  assert.equal(unchanged, first);

  const later = [run({ id: "r1", taskId: "t1" }), run({ id: "r2", taskId: "t2" })];
  const closedOnT1 = updateSeen(first, tasks, later, "t1");
  assert.equal(closedOnT1, first, "t1 did not change and t2 was not open");
  const openedT2 = updateSeen(first, tasks, later, "t2");
  assert.equal(openedT2.t2, "r2|succeeded");
  assert.equal(attentionFor(tasks, later, openedT2).length, 0);
});

test("seen entries for deleted tasks are dropped", () => {
  const seen = { gone: "r|succeeded", t1: "" };
  const next = updateSeen(seen, [task({ id: "t1" })], [], undefined);
  assert.deepEqual(next, { t1: "" });
});

test("grouped sections: inbox first, then projects in registration order, empty ones skipped", () => {
  const projects = [project("p1", "alpha"), project("p2", "beta"), project("p3", "empty")];
  const tasks = [
    task({ id: "b1", projectId: "p2", updatedAt: "2026-09-06T03:00:00.000Z" }),
    task({ id: "a1", projectId: "p1", updatedAt: "2026-09-06T01:00:00.000Z" }),
    task({ id: "a2", projectId: "p1", updatedAt: "2026-09-06T02:00:00.000Z" }),
    task({ id: "a3", projectId: "p1", status: "done", completedAt: "2026-09-05T00:00:00.000Z" }),
    task({ id: "loose" }),
    task({ id: "orphan", projectId: "removed" }),
  ];
  const runs = [run({ id: "r1", taskId: "a1", status: "running", finishedAt: undefined }), run({ id: "r2", taskId: "a2", status: "queued", finishedAt: undefined })];
  const sections = buildSections({ tasks, runs, projects, grouped: true });
  assert.deepEqual(
    sections.map((item) => item.key),
    ["inbox", "p1", "p2"],
  );
  assert.deepEqual(sections[0]?.open.map((item) => item.id), ["loose", "orphan"]);
  const alpha = sections[1]!;
  assert.deepEqual(alpha.open.map((item) => item.id), ["a2", "a1"]);
  assert.deepEqual(alpha.done.map((item) => item.id), ["a3"]);
  assert.equal(alpha.running, 1);
  assert.equal(alpha.queued, 1);
  assert.equal(activityLabel(alpha), "1 运行 · 1 排队");
  assert.equal(activityLabel(sections[2]!), "");
});

test("flat mode is one section, important tasks first, then newest; done sorted by completion", () => {
  const tasks = [
    task({ id: "old", updatedAt: "2026-09-01T00:00:00.000Z" }),
    task({ id: "new", updatedAt: "2026-09-07T00:00:00.000Z" }),
    task({ id: "urgent", priority: "high", updatedAt: "2026-09-02T00:00:00.000Z" }),
    task({ id: "d1", status: "done", completedAt: "2026-09-03T00:00:00.000Z" }),
    task({ id: "d2", status: "done", completedAt: "2026-09-04T00:00:00.000Z" }),
  ];
  const sections = buildSections({ tasks, runs: [], projects: [project("p1")], grouped: false });
  assert.equal(sections.length, 1);
  assert.equal(sections[0]?.kind, "all");
  assert.deepEqual(sections[0]?.open.map((item) => item.id), ["urgent", "new", "old"]);
  assert.deepEqual(sections[0]?.done.map((item) => item.id), ["d2", "d1"]);
});

test("the search matches title and details, case-insensitively, and drops empty sections", () => {
  const tasks = [task({ id: "t1", title: "修登录页", projectId: "p1" }), task({ id: "t2", title: "别的", details: "给 Login 加记住密码", projectId: "p2" })];
  const projects = [project("p1"), project("p2")];
  const hits = buildSections({ tasks, runs: [], projects, grouped: true, query: "login" });
  assert.deepEqual(hits.map((item) => item.key), ["p2"]);
  assert.deepEqual(buildSections({ tasks, runs: [], projects, grouped: false, query: "没有的" }), []);
});

test("the row dot: activity beats a failed last turn beats the task status", () => {
  const t = task({ id: "t1", status: "doing" });
  const failed = run({ id: "r1", taskId: "t1", status: "failed" });
  assert.equal(rowState(t, run({ id: "r2", taskId: "t1", status: "queued" }), failed), "queued");
  assert.equal(rowState(t, run({ id: "r2", taskId: "t1", status: "running" }), failed), "running");
  assert.equal(rowState(t, undefined, failed), "failed");
  assert.equal(rowState({ ...t, status: "done" }, undefined, failed), "done");
  assert.equal(rowState(t, undefined, run({ id: "r1", taskId: "t1" })), "doing");
});

test("the row agent: working now, else last turn, else the chip", () => {
  const t = task({ id: "t1", agent: "claude" });
  assert.equal(rowAgent(t, run({ id: "a", taskId: "t1", agent: "grok", status: "running" }), run({ id: "b", taskId: "t1", agent: "codex" })), "grok");
  assert.equal(rowAgent(t, undefined, run({ id: "b", taskId: "t1", agent: "codex" })), "codex");
  assert.equal(rowAgent(t, undefined, undefined), "claude");
});
