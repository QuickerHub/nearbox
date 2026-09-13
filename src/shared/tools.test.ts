import assert from "node:assert/strict";
import test from "node:test";
import { describeArgs, describeRawResult, firstLine, toolKindOf } from "./tools.ts";

test("firstLine returns the first non-empty trimmed line", () => {
  assert.equal(firstLine(""), "");
  assert.equal(firstLine("   \n\n"), "");
  assert.equal(firstLine("hello"), "hello");
  assert.equal(firstLine("  hello  "), "hello");
  assert.equal(firstLine("\n  skipped\nkept"), "skipped");
  assert.equal(firstLine("\r\n\r\n  second  \r\nthird"), "second");
  assert.equal(firstLine("only\r\n"), "only");
});

test("toolKindOf round-11 aliases: plan/todos, terminal, file_edit", () => {
  assert.equal(toolKindOf("CreatePlan"), "todo");
  assert.equal(toolKindOf("create_plan"), "todo");
  assert.equal(toolKindOf("WriteTodos"), "todo");
  assert.equal(toolKindOf("run_terminal_command"), "shell");
  assert.equal(toolKindOf("execute_bash"), "shell");
  assert.equal(toolKindOf("BashCommand"), "shell");
  assert.equal(toolKindOf("file_edit"), "edit");
});

test("describeArgs: web uri/href, absolute_path, arguments argv", () => {
  assert.equal(describeArgs("WebFetch", { uri: "https://example.com/a" }).subject, "https://example.com/a");
  assert.equal(describeArgs("web_fetch", { href: "https://ex.com/b" }).subject, "https://ex.com/b");
  const read = describeArgs("read", { absolute_path: "/tmp/a.ts" });
  assert.equal(read.subject, "a.ts");
  assert.deepEqual(read.files, ["/tmp/a.ts"]);
  const edit = describeArgs("edit", { target_path: "src/a.ts" });
  assert.equal(edit.subject, "a.ts");
  const shell = describeArgs("shell", { arguments: ["npm", "test"] });
  assert.equal(shell.command, "npm test");
  assert.equal(shell.subject, "npm test");
  const plan = describeArgs("CreatePlan", { name: "ship it" });
  assert.equal(plan.kind, "todo");
  assert.equal(plan.subject, "ship it");
});

test("describeRawResult honors snake_case match/file totals", () => {
  assert.deepEqual(describeRawResult({ total_matches: 3, truncated: true }), {
    output: "3 处匹配（结果已截断）",
  });
  assert.deepEqual(describeRawResult({ total_files: 12 }), { output: "12 个文件" });
});
