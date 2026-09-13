import assert from "node:assert/strict";
import test from "node:test";
import { describeCursorResult, describeRawResult, firstLine, toolKindOf } from "./tools.ts";

test("firstLine returns the first non-empty trimmed line", () => {
  assert.equal(firstLine(""), "");
  assert.equal(firstLine("   \n\n"), "");
  assert.equal(firstLine("hello"), "hello");
  assert.equal(firstLine("  hello  "), "hello");
  assert.equal(firstLine("\n  skipped\nkept"), "skipped");
  assert.equal(firstLine("\r\n\r\n  second  \r\nthird"), "second");
  assert.equal(firstLine("only\r\n"), "only");
});

test("toolKindOf recognises write_to_file and list_files", () => {
  assert.equal(toolKindOf("write_to_file"), "write");
  assert.equal(toolKindOf("WriteToFile"), "write");
  assert.equal(toolKindOf("create_new_file"), "write");
  assert.equal(toolKindOf("list_files"), "ls");
  assert.equal(toolKindOf("ListFiles"), "ls");
});

test("describeCursorResult reads filePath on edits and text on reads", () => {
  const edit = describeCursorResult("edit", {
    success: { diffString: "@@ -1 +1 @@\n-a\n+b\n", filePath: "src/a.ts" },
  });
  assert.deepEqual(edit.files, ["src/a.ts"]);
  assert.ok(edit.diff?.includes("-a"));

  const snake = describeCursorResult("write", {
    success: { file_path: "notes.md", linesAdded: 2 },
  });
  assert.deepEqual(snake.files, ["notes.md"]);
  assert.equal(snake.linesAdded, 2);

  const read = describeCursorResult("read", {
    success: { text: "hello world" },
  });
  assert.equal(read.output, "hello world");
});

test("describeRawResult keeps plain text payloads", () => {
  const fromText = describeRawResult({ text: "body" });
  assert.equal(fromText?.output, "body");
});
