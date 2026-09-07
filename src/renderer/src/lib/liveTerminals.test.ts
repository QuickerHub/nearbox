import assert from "node:assert/strict";
import test from "node:test";
import type { PendingPermission, RunEvent, RunEventKind, ToolCall } from "../../../shared/protocol.ts";
import {
  collectDockTerminals,
  dockStatusLabel,
  formatTerminalDuration,
  isLiveTerminal,
  lastOutputLine,
  terminalTitle,
} from "./liveTerminals.ts";

function ev(seq: number, kind: RunEventKind, tool?: ToolCall): RunEvent {
  return { seq, at: `2026-09-07T00:00:0${seq}.000Z`, kind, text: "", ...(tool ? { tool } : {}) };
}

function shell(id: string, patch: Partial<ToolCall> = {}): ToolCall {
  return { id, name: "shell", kind: "shell", status: "running", command: "npm test", ...patch };
}

const pending: PendingPermission = {
  toolCallId: "s2",
  title: "dir",
  command: "dir",
  options: [{ optionId: "allow", kind: "allow", label: "允许" }],
};

test("shell events collapse to one row and keep the latest status", () => {
  const terminals = collectDockTerminals([
    ev(1, "tool", shell("s1", { command: "npm test" })),
    ev(2, "tool", { id: "r1", name: "read", kind: "read", status: "ok", subject: "a.ts" }),
    ev(3, "tool", shell("s1", { command: "npm test", status: "ok", exitCode: 0, output: "ok\n" })),
  ]);
  assert.equal(terminals.length, 1);
  assert.equal(terminals[0]?.status, "ok");
  assert.equal(terminals[0]?.output, "ok\n");
  assert.equal(terminals[0]?.startedAt, "2026-09-07T00:00:01.000Z");
  assert.ok(!isLiveTerminal(terminals[0]!));
});

test("a pending permission marks that shell waiting, even before its event arrives", () => {
  const live = collectDockTerminals([ev(1, "tool", shell("s1"))], pending, "2026-09-07T00:00:00.000Z");
  assert.deepEqual(
    live.map((item) => [item.id, item.status, item.command]),
    [
      ["s1", "running", "npm test"],
      ["s2", "waiting", "dir"],
    ],
  );
  assert.ok(isLiveTerminal(live[1]!));

  const attached = collectDockTerminals([ev(1, "tool", shell("s2", { command: "dir" }))], pending);
  assert.equal(attached[0]?.status, "waiting");
  assert.equal(dockStatusLabel(attached[0]!), "等待确认");
});

test("labels and the last output line are what the dock shows", () => {
  assert.equal(dockStatusLabel({ status: "running" }), "运行中");
  assert.equal(dockStatusLabel({ status: "ok" }), "已完成");
  assert.equal(dockStatusLabel({ status: "error", exitCode: 2 }), "退出码 2");
  assert.equal(dockStatusLabel({ status: "rejected" }), "被拦截");
  assert.equal(terminalTitle({ command: "npm test", description: "跑测试" }), "跑测试");
  assert.equal(terminalTitle({ command: "npm test" }), "npm test");
  assert.equal(lastOutputLine("a\n\n  building…  \n"), "building…");
  assert.equal(lastOutputLine(""), "");
  assert.equal(formatTerminalDuration("2026-09-07T00:00:00.000Z", "2026-09-07T00:01:05.000Z"), "1 分 5 秒");
});
