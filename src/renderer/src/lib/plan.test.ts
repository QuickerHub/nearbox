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
  const latestRun = overrides.latestRun;
  return {
    draft: "hello",
    agent: "codex",
    agentLabel: "Codex",
    agentInfo: { kind: "codex", label: "Codex", available: true, supportsResume: true },
    projectId: "p1",
    projectName: "nearbox",
    runs: latestRun ? [latestRun] : [],
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
  assert.equal(planSend(input()).label, "发送");
  assert.equal(planSend(input({ draft: "  " })).enabled, false);
  assert.equal(planSend(input({ projectId: "" })).enabled, false);
});

test("a task with a finished conversation continues it", () => {
  const plan = planSend(input({ task: task(), latestRun: run() }));
  assert.equal(plan.action, "reply");
  assert.equal(plan.label, "发送");
  assert.equal(plan.resumeRunId, "r1");
  assert.equal(plan.queued, false);
  assert.equal(plan.continuing, true);
});

test("a message while the agent is busy is queued behind the running turn", () => {
  const running = run({ status: "running", sessionId: undefined });
  const plan = planSend(input({ task: task(), latestRun: running }));
  assert.equal(plan.action, "reply");
  assert.equal(plan.queued, true);
  assert.equal(plan.resumeRunId, "r1");
  assert.match(plan.hint, /排队/);
});

test("the chain is followed to the newest queued turn", () => {
  const running = run({ id: "r1", status: "running", sessionId: "sess-1" });
  const queued = run({ id: "r2", status: "queued", sessionId: undefined, resumedFromRunId: "r1" });
  const plan = planSend(input({ task: task(), latestRun: queued, runs: [running, queued] }));
  assert.equal(plan.action, "reply");
  assert.equal(plan.resumeRunId, "r2");
});

test("switching agent or project, or a session-less previous run, starts a new conversation", () => {
  assert.equal(planSend(input({ task: task(), latestRun: run(), agent: "cursor", agentLabel: "Cursor" })).action, "note-run");
  assert.equal(planSend(input({ task: task(), latestRun: run(), projectId: "p2" })).action, "note-run");
  assert.equal(planSend(input({ task: task(), latestRun: run({ sessionId: undefined }) })).action, "note-run");
});

test("asking for a fresh session skips the existing conversation and offers the way back", () => {
  const plan = planSend(input({ task: task(), latestRun: run(), fresh: true }));
  assert.equal(plan.action, "note-run");
  assert.equal(plan.canContinue, true);
  assert.match(plan.hint, /新开/);
  const empty = planSend(input({ task: task(), latestRun: run(), fresh: true, draft: "" }));
  assert.equal(empty.action, "run");
  assert.equal(empty.canContinue, true);
});

test("empty draft on a fresh task runs it as-is; empty draft in a conversation sends nothing", () => {
  const first = planSend(input({ task: task(), draft: "" }));
  assert.equal(first.action, "run");
  assert.equal(first.enabled, true);
  assert.equal(first.label, "运行");
  const again = planSend(input({ task: task(), draft: "", latestRun: run() }));
  assert.equal(again.action, "reply");
  assert.equal(again.enabled, false);
});

test("task without an agent picked only records", () => {
  assert.equal(planSend(input({ task: task(), agent: "" })).action, "note");
});
