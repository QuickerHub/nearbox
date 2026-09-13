import assert from "node:assert/strict";
import test from "node:test";
import {
  describeArgs,
  describeCursorResult,
  describeRawResult,
} from "./tools.ts";

test("describeArgs maps write/edit/delete/ls/glob subjects the remaining CLIs emit", () => {
  assert.deepEqual(describeArgs("WriteFile", { file_path: "src/app.ts" }), {
    name: "WriteFile",
    kind: "write",
    subject: "app.ts",
    files: ["src/app.ts"],
  });
  assert.equal(describeArgs("EditFile", { targetFile: "lib\\main.rs" }).subject, "main.rs");
  assert.deepEqual(describeArgs("DeleteFile", { path: "/tmp/old.txt" }).files, ["/tmp/old.txt"]);
  assert.deepEqual(describeArgs("ListDir", { directory: "src/lib" }), {
    name: "ListDir",
    kind: "ls",
    subject: "src/lib",
    cwd: "src/lib",
  });
  assert.equal(describeArgs("Glob", { globPattern: "**/*.test.ts", path: "src" }).subject, "**/*.test.ts");
  assert.equal(describeArgs("Glob", { globPattern: "**/*.test.ts", path: "src" }).cwd, "src");
});

test("describeArgs formats todo rows, MCP tool names, and kind overrides", () => {
  const todos = describeArgs("TodoWrite", {
    todos: [
      { content: "fix login", status: "completed" },
      { text: "add tests", status: "in_progress" },
      { title: "ship", completed: false },
    ],
  });
  assert.equal(todos.kind, "todo");
  assert.equal(todos.subject, "3 项");
  assert.equal(todos.output, "☑ fix login\n◐ add tests\n☐ ship");

  assert.equal(describeArgs("mcp_filesystem", { tool_name: "read_file" }).kind, "mcp");
  assert.equal(describeArgs("mcp_filesystem", { tool_name: "read_file" }).subject, "read_file");

  const overridden = describeArgs("mystery", { command: "npm test" }, "跑测试", "shell");
  assert.equal(overridden.kind, "shell");
  assert.equal(overridden.command, "npm test");
  assert.equal(overridden.description, "跑测试");

  const other = describeArgs("CustomThing", { foo: 1, bar: "ok" });
  assert.equal(other.kind, "other");
  assert.match(other.input ?? "", /"bar": "ok"/);
});

test("describeCursorResult covers edit/write diffs, glob listings, task steps and aborted shells", () => {
  const hunk = ["--- a/x.ts", "+++ b/x.ts", "@@ -1,3 +1,3 @@", " const a = 1;", "-const b = 8;", "+const b = 5;", " const c = 3;"].join("\n");
  const edited = describeCursorResult("edit", { success: { diffString: hunk, path: "x.ts" } });
  assert.equal(edited.status, "ok");
  assert.equal(edited.files?.[0], "x.ts");
  assert.equal(edited.linesAdded, 1);
  assert.equal(edited.linesRemoved, 1);
  assert.match(edited.diff ?? "", /const b = 5/);

  const written = describeCursorResult("write", { success: { linesAdded: 4, linesRemoved: 0, path: "new.ts" } });
  assert.equal(written.linesAdded, 4);
  assert.deepEqual(written.files, ["new.ts"]);

  const glob = describeCursorResult("glob", {
    success: { files: ["../.\\src\\App.jsx", "./readme.md", { path: "src/ok.ts" }], totalFiles: 3 },
  });
  assert.deepEqual(glob.files, ["src\\App.jsx", "readme.md", "src/ok.ts"]);
  assert.match(glob.output ?? "", /src\/ok\.ts/);

  const listed = describeCursorResult("ls", { success: { entries: [{ name: "a" }, { path: "b/" }, ""] } });
  assert.deepEqual(listed.files, ["a", "b/"]);

  const task = describeCursorResult("task", {
    success: {
      conversationSteps: [
        { assistantMessage: { text: "looking" } },
        { userMessage: { text: "ok" } },
        { assistantMessage: { text: "done" } },
      ],
    },
  });
  assert.equal(task.output, "done");

  const aborted = describeCursorResult("shell", {
    success: { interleavedOutput: "partial", exitCode: 0, aborted: true },
  });
  assert.equal(aborted.status, "ok");
  assert.equal(aborted.error, "命令被中止");

  const nonzero = describeCursorResult("shell", { success: { stdout: "oops", exitCode: 2 } });
  assert.equal(nonzero.status, "error");
  assert.equal(nonzero.exitCode, 2);

  assert.deepEqual(describeCursorResult("read", "not-an-object"), { status: "ok" });

  const nested = describeCursorResult("grep", { error: { error: { message: "pattern too wide" } } });
  assert.equal(nested.status, "error");
  assert.equal(nested.error, "pattern too wide");
});

test("describeRawResult reports match/file totals and truncation", () => {
  assert.deepEqual(describeRawResult({ totalMatches: 3 }), { output: "3 处匹配" });
  assert.deepEqual(describeRawResult({ totalMatches: 10, truncated: true }), { output: "10 处匹配（结果已截断）" });
  assert.deepEqual(describeRawResult({ totalFiles: 7 }), { output: "7 个文件" });
  assert.deepEqual(describeRawResult({ totalFiles: 200, truncated: true }), { output: "200 个文件（结果已截断）" });
  assert.equal(describeRawResult({ content: "x", extra: { nested: true } }), null);
});
