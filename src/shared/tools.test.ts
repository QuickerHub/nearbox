import assert from "node:assert/strict";
import test from "node:test";
import { firstLine, toolKindOf } from "./tools.ts";

test("firstLine returns the first non-empty trimmed line", () => {
  assert.equal(firstLine(""), "");
  assert.equal(firstLine("   \n\n"), "");
  assert.equal(firstLine("hello"), "hello");
  assert.equal(firstLine("  hello  "), "hello");
  assert.equal(firstLine("\n  skipped\nkept"), "skipped");
  assert.equal(firstLine("\r\n\r\n  second  \r\nthird"), "second");
  assert.equal(firstLine("only\r\n"), "only");
});

test("toolKindOf covers remaining delete/ls/shell/web/task aliases", () => {
  assert.equal(toolKindOf("Delete"), "delete");
  assert.equal(toolKindOf("DeleteFile"), "delete");
  assert.equal(toolKindOf("rm"), "delete");
  assert.equal(toolKindOf("ListDir"), "ls");
  assert.equal(toolKindOf("list_directory"), "ls");
  assert.equal(toolKindOf("tree"), "ls");
  assert.equal(toolKindOf("powershell"), "shell");
  assert.equal(toolKindOf("cmd"), "shell");
  assert.equal(toolKindOf("execute"), "shell");
  assert.equal(toolKindOf("find_files"), "glob");
  assert.equal(toolKindOf("file_search"), "glob");
  assert.equal(toolKindOf("web_fetch"), "web");
  assert.equal(toolKindOf("Fetch"), "web");
  assert.equal(toolKindOf("subagent"), "task");
  assert.equal(toolKindOf("spawn_agent"), "task");
  assert.equal(toolKindOf("notebook_edit"), "edit");
  assert.equal(toolKindOf("  Bash  "), "shell");
  assert.equal(toolKindOf("mcp_custom_tool"), "mcp");
});
