import assert from "node:assert/strict";
import test from "node:test";
import { describeArgs, describeCursorResult, firstLine, toolKindOf } from "./tools.ts";

test("firstLine returns the first non-empty trimmed line", () => {
  assert.equal(firstLine(""), "");
  assert.equal(firstLine("   \n\n"), "");
  assert.equal(firstLine("hello"), "hello");
  assert.equal(firstLine("  hello  "), "hello");
  assert.equal(firstLine("\n  skipped\nkept"), "skipped");
  assert.equal(firstLine("\r\n\r\n  second  \r\nthird"), "second");
  assert.equal(firstLine("only\r\n"), "only");
});

test("toolKindOf recognises replace_in_file and shell command aliases", () => {
  assert.equal(toolKindOf("replace_in_file"), "edit");
  assert.equal(toolKindOf("ReplaceInFile"), "edit");
  assert.equal(toolKindOf("run_shell_command"), "shell");
  assert.equal(toolKindOf("execute_command"), "shell");
  assert.equal(toolKindOf("shell_command"), "shell");
});

test("describeArgs reads commandLine and target path keys", () => {
  const shell = describeArgs("Bash", { commandLine: "npm test" });
  assert.equal(shell.kind, "shell");
  assert.equal(shell.command, "npm test");
  assert.equal(shell.subject, "npm test");
  assert.equal(shell.input, undefined);

  const snake = describeArgs("shell", { command_line: "pwd" });
  assert.equal(snake.command, "pwd");

  const edit = describeArgs("edit", { target: "src/a.ts", old_string: "x", new_string: "y" });
  assert.equal(edit.kind, "edit");
  assert.deepEqual(edit.files, ["src/a.ts"]);
  assert.equal(edit.subject, "a.ts");
});

test("describeCursorResult honors exit_code, aggregated_output, and diff", () => {
  const failed = describeCursorResult("shell", {
    success: { interleavedOutput: "boom", exit_code: 7 },
  });
  assert.equal(failed.status, "error");
  assert.equal(failed.exitCode, 7);
  assert.equal(failed.output, "boom");

  const agg = describeCursorResult("shell", {
    success: { aggregated_output: "hi\n", exitCode: 0 },
  });
  assert.equal(agg.status, "ok");
  assert.equal(agg.output, "hi\n");

  const edit = describeCursorResult("edit", {
    success: { diff: "@@ -1 +1 @@\n-a\n+b\n", path: "x.ts" },
  });
  assert.ok(edit.diff?.includes("-a"));
  assert.ok(edit.diff?.includes("+b"));
  assert.deepEqual(edit.files, ["x.ts"]);
});
