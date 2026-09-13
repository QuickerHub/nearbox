import assert from "node:assert/strict";
import test from "node:test";
import { describeCursorResult, firstLine } from "./tools.ts";

test("firstLine returns the first non-empty trimmed line", () => {
  assert.equal(firstLine(""), "");
  assert.equal(firstLine("   \n\n"), "");
  assert.equal(firstLine("hello"), "hello");
  assert.equal(firstLine("  hello  "), "hello");
  assert.equal(firstLine("\n  skipped\nkept"), "skipped");
  assert.equal(firstLine("\r\n\r\n  second  \r\nthird"), "second");
  assert.equal(firstLine("only\r\n"), "only");
});

test("an aborted shell under success is reported as an error", () => {
  const patch = describeCursorResult("shell", { success: { aborted: true, exitCode: 0, interleavedOutput: "partial" } });
  assert.equal(patch.status, "error");
  assert.equal(patch.error, "命令被中止");
  assert.equal(patch.exitCode, 0);
  assert.equal(patch.output, "partial");
});
