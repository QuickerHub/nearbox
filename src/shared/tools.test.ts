import assert from "node:assert/strict";
import test from "node:test";
import {
  describeArgs,
  describeCursorResult,
  describeRawResult,
  firstLine,
  toolKindOf,
} from "./tools.ts";

test("firstLine returns the first non-empty trimmed line", () => {
  assert.equal(firstLine(""), "");
  assert.equal(firstLine("   \n\n"), "");
  assert.equal(firstLine("hello"), "hello");
  assert.equal(firstLine("  hello  "), "hello");
  assert.equal(firstLine("\n  skipped\nkept"), "skipped");
  assert.equal(firstLine("\r\n\r\n  second  \r\nthird"), "second");
  assert.equal(firstLine("only\r\n"), "only");
});

test("toolKindOf round-12 aliases: Claude edit tool, shell/web/todo kin", () => {
  assert.equal(toolKindOf("StrReplaceBasedEditTool"), "edit");
  assert.equal(toolKindOf("apply_diff"), "edit");
  assert.equal(toolKindOf("search_and_replace"), "edit");
  assert.equal(toolKindOf("replace_string"), "edit");
  assert.equal(toolKindOf("MoveFile"), "edit");
  assert.equal(toolKindOf("ShellExecute"), "shell");
  assert.equal(toolKindOf("exec_command"), "shell");
  assert.equal(toolKindOf("run_bash"), "shell");
  assert.equal(toolKindOf("TerminalCmd"), "shell");
  assert.equal(toolKindOf("ShellTool"), "shell");
  assert.equal(toolKindOf("run_pty_cmd"), "shell");
  assert.equal(toolKindOf("NewFile"), "write");
  assert.equal(toolKindOf("make_file"), "write");
  assert.equal(toolKindOf("GetFileContents"), "read");
  assert.equal(toolKindOf("read_resource"), "read");
  assert.equal(toolKindOf("unlink"), "delete");
  assert.equal(toolKindOf("erase_file"), "delete");
  assert.equal(toolKindOf("DirList"), "ls");
  assert.equal(toolKindOf("list_tree"), "ls");
  assert.equal(toolKindOf("file_finder"), "glob");
  assert.equal(toolKindOf("rg"), "grep");
  assert.equal(toolKindOf("workspace_search"), "grep");
  assert.equal(toolKindOf("BrowseUrl"), "web");
  assert.equal(toolKindOf("fetch_webpage"), "web");
  assert.equal(toolKindOf("open_url"), "web");
  assert.equal(toolKindOf("ManageTodoList"), "todo");
  assert.equal(toolKindOf("set_todos"), "todo");
  assert.equal(toolKindOf("edit_todos"), "todo");
});

test("describeArgs: fileName/pathname, searchQuery/address, search_pattern, cmd_line", () => {
  const named = describeArgs("Read", { fileName: "src/a.ts" });
  assert.equal(named.kind, "read");
  assert.equal(named.subject, "a.ts");
  assert.deepEqual(named.files, ["src/a.ts"]);

  const pathnamed = describeArgs("Read", { pathname: "/tmp/notes.md" });
  assert.equal(pathnamed.subject, "notes.md");
  assert.deepEqual(pathnamed.files, ["/tmp/notes.md"]);

  const web = describeArgs("WebSearch", { searchQuery: "nearbox" });
  assert.equal(web.kind, "web");
  assert.equal(web.subject, "nearbox");

  const fetch = describeArgs("WebFetch", { address: "https://example.com" });
  assert.equal(fetch.subject, "https://example.com");

  const grep = describeArgs("Grep", { search_pattern: "TODO", path: "src" });
  assert.equal(grep.kind, "grep");
  assert.equal(grep.subject, "TODO");
  assert.equal(grep.cwd, "src");

  const shell = describeArgs("Shell", { cmd_line: "ls -la" });
  assert.equal(shell.command, "ls -la");
  assert.equal(shell.subject, "ls -la");
});

test("describeCursorResult: exit_status/interleaved_output, read data, grep matchCount, task answer", () => {
  const failed = describeCursorResult("shell", {
    success: { interleaved_output: "boom", exit_status: 3 },
  });
  assert.equal(failed.status, "error");
  assert.equal(failed.exitCode, 3);
  assert.equal(failed.output, "boom");

  const coded = describeCursorResult("shell", {
    success: { stdout: "x", status_code: 2 },
  });
  assert.equal(coded.status, "error");
  assert.equal(coded.exitCode, 2);

  const read = describeCursorResult("read", { success: { data: "file body" } });
  assert.equal(read.output, "file body");

  const body = describeCursorResult("read", { success: { body: "alt" } });
  assert.equal(body.output, "alt");

  const grep = describeCursorResult("grep", { success: { matchCount: 5, truncated: true } });
  assert.equal(grep.output, "5 处匹配（结果已截断）");

  const task = describeCursorResult("task", { success: { answer: "done" } });
  assert.equal(task.output, "done");
});

test("describeRawResult honors errorMessage / error_message", () => {
  assert.deepEqual(describeRawResult({ errorMessage: "nope" }), { status: "error", error: "nope" });
  assert.deepEqual(describeRawResult({ error_message: "fail" }), { status: "error", error: "fail" });
});
