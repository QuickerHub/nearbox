import assert from "node:assert/strict";
import test from "node:test";
import { coerceExitCode, describeArgs, describeCursorResult, firstLine, pickPathList } from "./tools.ts";

test("firstLine returns the first non-empty trimmed line", () => {
  assert.equal(firstLine(""), "");
  assert.equal(firstLine("   \n\n"), "");
  assert.equal(firstLine("hello"), "hello");
  assert.equal(firstLine("  hello  "), "hello");
  assert.equal(firstLine("\n  skipped\nkept"), "skipped");
  assert.equal(firstLine("\r\n\r\n  second  \r\nthird"), "second");
  assert.equal(firstLine("only\r\n"), "only");
});

test("pickPathList / describeArgs keep multi-file path arrays as files, not JSON input", () => {
  assert.deepEqual(pickPathList({ paths: ["src/a.ts", "src/b.ts"] }), ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(pickPathList({ path: "solo.ts", files: ["solo.ts", "other.ts"] }), ["solo.ts", "other.ts"]);
  const multi = describeArgs("MultiEdit", { paths: ["D:\\p\\a.ts", "D:\\p\\b.ts"] });
  assert.equal(multi.kind, "edit");
  assert.deepEqual(multi.files, ["D:\\p\\a.ts", "D:\\p\\b.ts"]);
  assert.equal(multi.subject, "a.ts 等 2 个文件");
  assert.equal(multi.input, undefined);
  const single = describeArgs("Read", { file_path: "/repo/x.ts" });
  assert.deepEqual(single.files, ["/repo/x.ts"]);
  assert.equal(single.subject, "x.ts");
});

test("coerceExitCode accepts numbers and numeric strings", () => {
  assert.equal(coerceExitCode(0), 0);
  assert.equal(coerceExitCode(3), 3);
  assert.equal(coerceExitCode("1"), 1);
  assert.equal(coerceExitCode(" 2 "), 2);
  assert.equal(coerceExitCode(""), undefined);
  assert.equal(coerceExitCode("nope"), undefined);
  assert.equal(coerceExitCode(undefined), undefined);
});

test("describeCursorResult treats string exitCode like a number", () => {
  const patch = describeCursorResult("shell", { success: { exitCode: "2", stdout: "fail\n", stderr: "" } });
  assert.equal(patch.exitCode, 2);
  assert.equal(patch.status, "error");
  assert.ok(patch.output?.includes("fail"));
});
