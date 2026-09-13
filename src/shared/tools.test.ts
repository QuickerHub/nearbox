import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanGlobPath,
  describeArgs,
  describeCursorResult,
  describeRawResult,
  firstLine,
  prettyArgs,
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

test("describeArgs maps shell/read/grep/web subjects from common CLI keys", () => {
  assert.deepEqual(describeArgs("Shell", { command: "ls -la", working_directory: "/tmp" }), {
    name: "Shell",
    kind: "shell",
    command: "ls -la",
    subject: "ls -la",
    cwd: "/tmp",
  });
  assert.equal(describeArgs("ReadFile", { target_file: "src/app.ts" }).subject, "app.ts");
  assert.deepEqual(describeArgs("ReadFile", { target_file: "src/app.ts" }).files, ["src/app.ts"]);
  assert.equal(describeArgs("grep", { pattern: "TODO", path: "src" }).subject, "TODO");
  assert.equal(describeArgs("WebSearch", { search_term: "nearbox" }).subject, "nearbox");
  assert.equal(describeArgs("Task", { prompt: "fix\nthe bug" }).subject, "fix");
});

test("cleanGlobPath strips cursor-agent relative prefixes", () => {
  assert.equal(cleanGlobPath("..\\src\\App.jsx"), "src\\App.jsx");
  assert.equal(cleanGlobPath("../src/App.jsx"), "src/App.jsx");
  assert.equal(cleanGlobPath("./readme.md"), "readme.md");
  assert.equal(cleanGlobPath("src/ok.ts"), "src/ok.ts");
});

test("prettyArgs drops empty values and stays JSON", () => {
  assert.equal(prettyArgs({ a: 1, b: "", c: null, d: [], e: "ok" }), '{\n  "a": 1,\n  "e": "ok"\n}');
});

test("describeCursorResult maps success/rejected/error outcomes", () => {
  assert.deepEqual(describeCursorResult("read", { success: { content: "hello" } }), {
    status: "ok",
    output: "hello",
  });
  assert.deepEqual(describeCursorResult("shell", { rejected: { reason: "denied" } }), {
    status: "rejected",
    error: "denied",
  });
  const failedShell = describeCursorResult("shell", {
    failure: { interleavedOutput: "boom", exitCode: 2 },
  });
  assert.equal(failedShell.status, "error");
  assert.equal(failedShell.exitCode, 2);
  assert.equal(failedShell.output, "boom");
  assert.ok(failedShell.error);
});

test("describeRawResult recognizes flat ACP tool payloads", () => {
  assert.deepEqual(describeRawResult({ content: "file body" }), { output: "file body" });
  assert.deepEqual(describeRawResult({ error: "nope" }), { status: "error", error: "nope" });
  assert.equal(describeRawResult({ nested: { x: 1 } }), null);
});
