import assert from "node:assert/strict";
import test from "node:test";
import { argvText, describeArgs, describeCursorResult, firstLine, stripFileUri, toolKindOf } from "./tools.ts";

test("firstLine returns the first non-empty trimmed line", () => {
  assert.equal(firstLine(""), "");
  assert.equal(firstLine("   \n\n"), "");
  assert.equal(firstLine("hello"), "hello");
  assert.equal(firstLine("  hello  "), "hello");
  assert.equal(firstLine("\n  skipped\nkept"), "skipped");
  assert.equal(firstLine("\r\n\r\n  second  \r\nthird"), "second");
  assert.equal(firstLine("only\r\n"), "only");
});

test("toolKindOf maps SemanticSearch EditNotebook OpenFile and kin", () => {
  assert.equal(toolKindOf("SemanticSearch"), "grep");
  assert.equal(toolKindOf("EditNotebook"), "edit");
  assert.equal(toolKindOf("OpenFile"), "read");
  assert.equal(toolKindOf("RunTerminal"), "shell");
  assert.equal(toolKindOf("OverwriteFile"), "write");
  assert.equal(toolKindOf("DeleteFiles"), "delete");
  assert.equal(toolKindOf("RemoveFile"), "delete");
});

test("describeArgs reads argv tokens and file:// uri paths", () => {
  assert.deepEqual(describeArgs("Bash", { argv: ["git", "status"], working_directory: "/repo" }), {
    name: "Bash",
    kind: "shell",
    command: "git status",
    subject: "git status",
    cwd: "/repo",
  });
  const listed = describeArgs("Shell", { args: ["ls", "-la"] });
  assert.equal(listed.kind, "shell");
  assert.equal(listed.command, "ls -la");
  assert.equal(listed.subject, "ls -la");
  assert.deepEqual(describeArgs("Read", { uri: "file:///home/a/b.ts" }), {
    name: "Read",
    kind: "read",
    subject: "b.ts",
    files: ["/home/a/b.ts"],
  });
  assert.equal(argvText(["a", 1, true]), "a 1 true");
  assert.equal(argvText([{ no: "pe" }]), "");
  assert.equal(stripFileUri("file:///C:/tmp/x.ts"), "C:/tmp/x.ts");
});

test("describeCursorResult honors snake_case diff_string and line counts", () => {
  const patch = describeCursorResult("edit", {
    success: { path: "a.ts", diff_string: "@@\n+hi", lines_added: 1, lines_removed: 0 },
  });
  assert.equal(patch.status, "ok");
  assert.ok(typeof patch.diff === "string" && patch.diff.includes("+hi"));
  assert.equal(patch.linesAdded, 1);
  assert.equal(patch.linesRemoved, 0);
  assert.deepEqual(patch.files, ["a.ts"]);

  const countsOnly = describeCursorResult("write", {
    success: { path: "b.ts", lines_added: 3, lines_removed: 2 },
  });
  assert.equal(countsOnly.linesAdded, 3);
  assert.equal(countsOnly.linesRemoved, 2);
});
