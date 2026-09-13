import assert from "node:assert/strict";
import test from "node:test";
import {
  asArray,
  basenameOf,
  clipHead,
  clipTail,
  compact,
  firstLine,
  isRecord,
  looseJson,
  pickString,
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

test("toolKindOf normalizes CLI naming styles", () => {
  assert.equal(toolKindOf("ShellToolCall"), "shell");
  assert.equal(toolKindOf("run-terminal-cmd"), "shell");
  assert.equal(toolKindOf("ReadFile"), "read");
  assert.equal(toolKindOf("ApplyPatch"), "edit");
  assert.equal(toolKindOf("codebase_search"), "grep");
  assert.equal(toolKindOf("mcp_filesystem_read"), "mcp");
  assert.equal(toolKindOf("mysteryThing"), "other");
});

test("clip helpers and path basename stay bounded", () => {
  assert.equal(clipHead("abcdef", 4), "abcd\n… 已省略 2 个字符");
  assert.equal(clipTail("abcdef", 4), "… 已省略前 2 个字符\ncdef");
  assert.equal(clipHead("abc", 10), "abc");
  assert.equal(basenameOf("D:\\code\\app\\file.ts"), "file.ts");
  assert.equal(basenameOf("/home/cea/proj/readme.md"), "readme.md");
  assert.equal(basenameOf("solo"), "solo");
});

test("record helpers and looseJson tolerate messy agent payloads", () => {
  assert.equal(isRecord({ a: 1 }), true);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord([1]), false);
  assert.deepEqual(asArray([1, 2]), [1, 2]);
  assert.deepEqual(asArray(7), []);
  assert.equal(pickString({ file_path: "a.ts", path: "b.ts" }, ["path", "file_path"]), "b.ts");
  assert.equal(pickString({ file_path: "a.ts" }, ["path", "file_path"]), "a.ts");
  assert.deepEqual(looseJson('{"ok": true}'), { ok: true });
  assert.equal(looseJson("not json"), null);
  assert.equal(compact({ a: 1, b: undefined }), '{"a":1}');
});
