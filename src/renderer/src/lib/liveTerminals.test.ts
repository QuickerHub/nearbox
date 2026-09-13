import assert from "node:assert/strict";
import test from "node:test";
import type { PendingPermission, RunEvent, RunEventKind, ToolCall } from "../../../shared/protocol.ts";
import {
  collectDockTerminals,
  dockStatusLabel,
  formatTerminalDuration,
  isLiveTerminal,
  lastOutputLine,
  shouldStickToBottom,
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
  askId: "ask-s2",
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
  assert.equal(lastOutputLine("a\r\nb\r\n  c  \r\n\r\n"), "c");
  assert.equal(lastOutputLine("only"), "only");
  assert.equal(lastOutputLine("   \n\t"), "");
  assert.equal(formatTerminalDuration("2026-09-07T00:00:00.000Z", "2026-09-07T00:01:05.000Z"), "1 分 5 秒");
});

test("lastOutputLine strips ANSI before reading the tip", () => {
  assert.equal(lastOutputLine("\u001b[32mOK\u001b[0m\n\u001b[1;31mERR\u001b[0m"), "ERR");
});

test("shouldStickToBottom respects a small slop near the end", () => {
  assert.equal(shouldStickToBottom(0, 100, 100), true);
  assert.equal(shouldStickToBottom(50, 200, 100), false); // 50px left > 48 slop
  assert.equal(shouldStickToBottom(52, 200, 100), true); // exactly 48
  assert.equal(shouldStickToBottom(0, 500, 100), false);
});
