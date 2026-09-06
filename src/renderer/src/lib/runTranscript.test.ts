import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent, RunEventKind } from "../../../shared/protocol.ts";
import { buildTranscript, parseToolLine, splitWork, toolLabel } from "./runTranscript.ts";

function ev(seq: number, kind: RunEventKind, text: string): RunEvent {
  return { seq, at: "2026-09-06T00:00:00.000Z", kind, text };
}

test("cursor read/complete pair becomes one file tool", () => {
  const items = buildTranscript([
    ev(1, "status", "已收到任务"),
    ev(2, "thinking", "The user requested PONG"),
    ev(3, "tool", 'read {"path":"a.ts"}'),
    ev(4, "tool", '完成 read: {"success":{"content":"x"}}'),
    ev(5, "text", "PONG"),
    ev(6, "result", "完成 · 5s"),
  ]);
  const tools = items.filter((item) => item.type === "tool");
  assert.equal(tools.length, 1);
  assert.equal(tools[0]?.tool.name, "读取文件");
  assert.equal(tools[0]?.tool.kind, "file");
  assert.equal(tools[0]?.tool.status, "done");
  assert.equal(tools[0]?.tool.meta, "a.ts");
  const split = splitWork(items);
  assert.equal(split.toolCount, 1);
  assert.equal(split.summary.some((item) => item.type === "text" && item.text === "PONG"), true);
  assert.equal(split.work.some((item) => item.type === "thinking"), true);
});

test("codex shell start/end pair becomes one terminal tool", () => {
  const items = buildTranscript([
    ev(1, "tool", "$ npm test"),
    ev(2, "tool", "命令结束 (exit 0)\nok"),
    ev(3, "text", "PONG"),
  ]);
  assert.equal(items[0]?.type, "tool");
  if (items[0]?.type !== "tool") {
    return;
  }
  assert.equal(items[0].tool.kind, "shell");
  assert.equal(items[0].tool.command, "npm test");
  assert.equal(items[0].tool.output, "ok");
  assert.equal(items[0].tool.status, "done");
  assert.equal(items[0].tool.exitCode, 0);
});

test("failed shell stays error", () => {
  const parsed = parseToolLine("命令结束 (exit 2)\nboom");
  assert.equal(parsed.status, "error");
  assert.equal(parsed.exitCode, 2);
});

test("tool labels cover common agent names", () => {
  assert.equal(toolLabel("readToolCall"), "读取文件");
  assert.equal(toolLabel("run_command"), "终端");
  assert.equal(toolLabel("web_search"), "网页搜索");
});
