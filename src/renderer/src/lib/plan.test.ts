import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRun, Task } from "../../../shared/protocol.ts";
import { planSend, type PlanInput } from "./plan.ts";

const actor = { id: "desktop", name: "PC", role: "desktop" as const };

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "加个按钮",
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

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "r1",
    taskId: "t1",
    projectId: "p1",
    agent: "codex",
    access: "safe",
    prompt: "x",
    cwd: "D:\\x",
    status: "succeeded",
    requestedBy: actor,
    createdAt: "2026-09-06T00:00:00.000Z",
    eventCount: 3,
    sessionId: "sess-1",
    ...overrides,
  };
}

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    draft: "hello",
    agent: "codex",
    agentLabel: "Codex",
    agentInfo: { kind: "codex", label: "Codex", available: true, supportsResume: true },
    projectId: "p1",
    projectName: "nearbox",
    ...overrides,
  };
}

test("no task + no agent captures to the inbox", () => {
  const plan = planSend(input({ agent: "" }));
  assert.equal(plan.action, "capture");
  assert.equal(plan.enabled, true);
});

test("no task + agent + project creates and runs; needs text", () => {
  assert.equal(planSend(input()).action, "create-run");
  assert.equal(planSend(input({ draft: "  " })).enabled, false);
  assert.equal(planSend(input({ projectId: "" })).enabled, false);
});

test("task with an active run only records notes", () => {
  const plan = planSend(input({ task: task(), activeRun: run({ status: "running" }) }));
  assert.equal(plan.action, "note");
});

test("task with a resumable previous run replies", () => {
  const plan = planSend(input({ task: task(), latestRun: run() }));
  assert.equal(plan.action, "reply");
});

test("switching agent or project falls back to note + fresh run", () => {
  assert.equal(planSend(input({ task: task(), latestRun: run(), agent: "cursor", agentLabel: "Cursor" })).action, "note-run");
  assert.equal(planSend(input({ task: task(), latestRun: run(), projectId: "p2" })).action, "note-run");
  assert.equal(planSend(input({ task: task(), latestRun: run({ sessionId: undefined }) })).action, "note-run");
});

test("empty draft on a task runs it as-is", () => {
  const first = planSend(input({ task: task(), draft: "" }));
  assert.equal(first.action, "run");
  assert.equal(first.enabled, true);
  assert.equal(first.label, "运行");
  const again = planSend(input({ task: task(), draft: "", latestRun: run() }));
  assert.equal(again.label, "重新运行");
});

test("task without an agent picked only records", () => {
  assert.equal(planSend(input({ task: task(), agent: "" })).action, "note");
});
