import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvent, RunEventKind, ToolCall } from "../../../shared/protocol.ts";
import { buildTranscript, diffLines, displayTool, groupLabel, summarizeTranscript, toolVerb } from "./runTranscript.ts";

function ev(seq: number, kind: RunEventKind, text: string, tool?: ToolCall, delta?: boolean): RunEvent {
  return { seq, at: "2026-09-06T00:00:00.000Z", kind, text, ...(tool ? { tool } : {}), ...(delta ? { delta } : {}) };
}

function call(id: string, patch: Partial<ToolCall>): ToolCall {
  return { id, name: "tool", kind: "other", status: "running", ...patch };
}

test("start and completion of the same call collapse into one item at the original position", () => {
  const items = buildTranscript([
    ev(1, "thinking", "Let me look"),
    ev(2, "tool", "读取 a.ts", call("c1", { kind: "read", subject: "a.ts" })),
    ev(3, "tool", "读取 b.ts", call("c2", { kind: "read", subject: "b.ts" })),
    ev(4, "tool", "读取 b.ts", call("c2", { kind: "read", subject: "b.ts", status: "ok", output: "B" })),
    ev(5, "tool", "读取 a.ts", call("c1", { kind: "read", subject: "a.ts", status: "ok", output: "A" })),
    ev(6, "text", "PONG"),
    ev(7, "result", "完成 · 5s"),
  ]);
  const tools = items.filter((item) => item.type === "tool");
  assert.equal(tools.length, 2);
  assert.deepEqual(
    tools.map((item) => (item.type === "tool" ? [item.tool.id, item.tool.status, item.tool.output] : null)),
    [
      ["c1", "ok", "A"],
      ["c2", "ok", "B"],
    ],
  );
  assert.ok(!items.some((item) => item.type === "status"));
});

test("consecutive lookups are grouped, the trailing text becomes the answer", () => {
  const items = buildTranscript([
    ev(1, "status", "启动 Cursor Agent · 安全模式 · D:\\x"),
    ev(2, "text", "先看看代码。"),
    ev(3, "tool", "读取 a.ts", call("c1", { kind: "read", subject: "a.ts", status: "ok" })),
    ev(4, "tool", "读取 b.ts", call("c2", { kind: "read", subject: "b.ts", status: "ok" })),
    ev(5, "tool", "查找 *.ts", call("c3", { kind: "glob", subject: "*.ts", status: "ok" })),
    ev(6, "tool", "$ npm test", call("c4", { kind: "shell", command: "npm test", status: "ok", exitCode: 0, output: "ok" })),
    ev(7, "text", "都好了。"),
    ev(8, "text", "改了两个文件。"),
    ev(9, "status", "运行结束"),
  ]);
  const summary = summarizeTranscript(items);
  assert.equal(summary.answer, "都好了。\n改了两个文件。");
  assert.equal(summary.toolCount, 4);
  assert.deepEqual(summary.running, []);
  assert.deepEqual(
    summary.work.map((row) => (row.type === "tools" ? `${row.type}:${row.kind}:${row.tools.length}` : row.type === "tool" ? `tool:${row.tool.kind}` : row.type)),
    ["text", "tools:read:2", "tool:glob", "tool:shell"],
  );
});

test("a turn without tools is all answer, and running tools are reported", () => {
  const plain = summarizeTranscript(buildTranscript([ev(1, "text", "你好")]));
  assert.equal(plain.answer, "你好");
  assert.equal(plain.work.length, 0);

  const live = summarizeTranscript(
    buildTranscript([
      ev(1, "tool", "$ npm run build", call("s1", { kind: "shell", command: "npm run build" })),
      ev(2, "stderr", "warning: something"),
      ev(3, "stderr", "warning: else"),
    ]),
  );
  assert.equal(live.answer, "");
  assert.equal(live.running.length, 1);
  assert.equal(live.running[0]?.command, "npm run build");
  const stderr = live.work.find((row) => row.type === "stderr");
  assert.equal(stderr?.type === "stderr" ? stderr.lines.length : 0, 2);
});

test("streamed fragments join verbatim while whole messages get a line break", () => {
  const items = buildTranscript([
    ev(1, "thinking", "Let me", undefined, true),
    ev(2, "thinking", " think.", undefined, true),
    ev(3, "text", "Hello ", undefined, true),
    ev(4, "text", "world,\n", undefined, true),
    ev(5, "text", "done", undefined, true),
    ev(6, "text", "Second message"),
  ]);
  assert.deepEqual(
    items.map((item) => (item.type === "thinking" || item.type === "text" ? [item.type, item.text] : item.type)),
    [
      ["thinking", "Let me think."],
      ["text", "Hello world,\ndone\nSecond message"],
    ],
  );
  assert.equal(summarizeTranscript(items).answer, "Hello world,\ndone\nSecond message");
});

test("legacy text-only tool events still pair up", () => {
  const items = buildTranscript([
    ev(1, "tool", 'read {"path":"a.ts"}'),
    ev(2, "tool", '完成 read: {"success":{"content":"x"}}'),
    ev(3, "tool", "$ npm test"),
    ev(4, "tool", "命令结束 (exit 2)\nboom"),
  ]);
  const tools = items.filter((item) => item.type === "tool").map((item) => (item.type === "tool" ? item.tool : null));
  assert.equal(tools.length, 2);
  assert.equal(tools[0]?.status, "ok");
  assert.equal(tools[1]?.kind, "shell");
  assert.equal(tools[1]?.command, "npm test");
  assert.equal(tools[1]?.status, "error");
  assert.equal(tools[1]?.exitCode, 2);
  assert.equal(tools[1]?.output, "boom");
});

test("legacy cursor-agent lines become real rows even when the JSON was cut short", () => {
  const items = buildTranscript([
    ev(1, "tool", 'glob {"targetDirectory":"C:\\\\Users\\\\ldy\\\\proj\\\\terminals","globPattern":"*.txt"}'),
    ev(2, "tool", 'glob {"targetDirectory":"D:\\\\Work\\\\test","globPattern":"package.json"}'),
    ev(3, "tool", '完成 glob: {"error":{"error":"Path does not exist: C:\\\\Users\\\\ldy\\\\proj\\\\terminals"}}'),
    ev(4, "tool", '完成 glob: {"success":{"pattern":"","path":"D:\\\\Work\\\\test","files":["../.\\\\package.json"],"totalFiles":1}}'),
    // Truncated by the old logger mid-string: arguments are salvaged as far as they go.
    ev(5, "tool", 'shell {"command":"dir","workingDirectory":"D:\\\\Work\\\\test","timeout":30000,"toolCallId":"call-00390b23-0e38-4dcf-a885-8acc632fb0fc-13\nfc_ozCXi1i-3LY…'),
    ev(6, "tool", '完成 shell: {"rejected":{"command":"dir","workingDirectory":"D:\\\\Work\\\\test","reason":"","isReadonly":false}}'),
    ev(7, "tool", 'task {"description":"Restart Vite server","prompt":"Restart the Vite dev server for the project…'),
    ev(8, "tool", '完成 task: {"success":{"conversationSteps":[{"assistantMessage":{"text":"先检查本机是否…'),
  ]);
  const tools = items.filter((item): item is Extract<typeof item, { type: "tool" }> => item.type === "tool").map((item) => item.tool);
  assert.deepEqual(
    tools.map((tool) => [tool.kind, tool.subject, tool.status]),
    [
      ["glob", "*.txt", "error"],
      ["glob", "package.json", "ok"],
      ["shell", "dir", "rejected"],
      ["task", "Restart Vite server", "ok"],
    ],
  );
  assert.equal(tools[0]?.error, "Path does not exist: C:\\Users\\ldy\\proj\\terminals");
  assert.deepEqual(tools[1]?.files, ["package.json"]);
  assert.equal(tools[2]?.command, "dir");
  assert.equal(tools[2]?.cwd, "D:\\Work\\test");
  assert.match(tools[2]?.error ?? "", /拒绝/);
});

test("labels read naturally", () => {
  assert.equal(toolVerb({ kind: "read", status: "running" }), "读取");
  assert.equal(toolVerb({ kind: "read", status: "ok" }), "读取了");
  assert.equal(groupLabel("read", 4, false), "读取了 4 个文件");
  assert.equal(groupLabel("grep", 2, true), "搜索 2 次");
});

test("older logs that kept cursor-agent's raw JSON results are unwrapped for display", () => {
  const read = displayTool(call("r", { kind: "read", status: "ok", output: '{"content":"using System;\\n\\nclass A\\n{\\n}\\n"}' }));
  assert.equal(read.output, "using System;\n\nclass A\n{\n}\n");
  const grep = displayTool(call("g", { kind: "grep", status: "ok", output: '{"totalMatches":3753,"truncated":true}' }));
  assert.equal(grep.output, "3753 处匹配（结果已截断）");
  const failed = displayTool(call("f", { kind: "grep", status: "ok", output: '{"error":"Glob pattern \\"**/*\\" matches every file and is not allowed."}' }));
  assert.equal(failed.status, "error");
  assert.match(failed.error ?? "", /not allowed/);
  assert.equal(failed.output, undefined);
  // A read of an actual JSON file is content, not a wrapper.
  const json = displayTool(call("j", { kind: "read", status: "ok", output: '{\n  "name": "react-app",\n  "scripts": { "dev": "vite" }\n}' }));
  assert.equal(json.output, '{\n  "name": "react-app",\n  "scripts": { "dev": "vite" }\n}');
  // A wrapper cut short by the output limit is decoded as far as it goes.
  const clipped = displayTool(call("c", { kind: "read", status: "ok", output: '{"content":"line one\\nline two\\nsaid \\"hi\\" \\u00e9\\u\n… 已省略 5000 个字符' }));
  assert.equal(clipped.output, 'line one\nline two\nsaid "hi" é\n… 已省略 5000 个字符');
  assert.equal(displayTool(call("p", { kind: "read", status: "ok", output: "plain text" })).output, "plain text");
});

test("diff lines carry numbers from the hunk headers and drop the file header", () => {
  const diff = ["--- a/x.sql", "+++ b/x.sql", "@@ -10,4 +10,4 @@", " select 1;", "--- old", "+-- new", " select 2;", "@@ -30,1 +30,2 @@", " x", "+y"].join("\n");
  assert.deepEqual(
    diffLines(diff).map((line) => [line.tag, line.text, line.oldNo, line.newNo]),
    [
      ["meta", "--- a/x.sql", undefined, undefined],
      ["meta", "+++ b/x.sql", undefined, undefined],
      ["hunk", "@@ -10,4 +10,4 @@", undefined, undefined],
      ["ctx", "select 1;", 10, 10],
      ["del", "-- old", 11, undefined],
      ["add", "-- new", undefined, 11],
      ["ctx", "select 2;", 12, 12],
      ["hunk", "@@ -30,1 +30,2 @@", undefined, undefined],
      ["ctx", "x", 30, 30],
      ["add", "y", undefined, 31],
    ],
  );
  // cursor-agent's diffString for a new file has the header but no hunk: numbering starts at 1.
  const created = diffLines("--- /dev/null\n+++ b/hello.txt\n+hi\n+there");
  assert.deepEqual(
    created.filter((line) => line.tag === "add").map((line) => line.newNo),
    [1, 2],
  );
});

test("old whole-file diffs (every line removed, then every line added) are re-diffed for real", () => {
  const before = ["const a = 1;", "const b = 8;", "const c = 3;", ""];
  const after = ["const a = 1;", "const b = 5;", "const c = 3;", ""];
  const legacy = [...before.map((line) => `-${line}`), ...after.map((line) => `+${line}`)].join("\n");
  assert.deepEqual(
    diffLines(legacy).map((line) => `${line.tag}:${line.text}`),
    ["hunk:@@ -1,3 +1,3 @@", "ctx:const a = 1;", "del:const b = 8;", "add:const b = 5;", "ctx:const c = 3;"],
  );
  // A cut-off one cannot be rebuilt and is shown as recorded, note included.
  const clipped = `-a\n-b\n+a\n… 已省略 120 个字符`;
  assert.deepEqual(
    diffLines(clipped).map((line) => line.tag),
    ["del", "del", "add", "note"],
  );
});
