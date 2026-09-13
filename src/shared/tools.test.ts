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

test("describeCursorResult keeps string-valued failure bodies", () => {
  const failed = describeCursorResult("shell", { failure: "exit 1: boom" });
  assert.equal(failed.status, "error");
  assert.equal(failed.error, "exit 1: boom");
  assert.equal(failed.output, "exit 1: boom");
  const rejected = describeCursorResult("shell", { rejected: "blocked by policy" });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.error, "blocked by policy");
  const ok = describeCursorResult("read", { success: "file body" });
  assert.equal(ok.status, "ok");
  assert.equal(ok.output, "file body");
});
