import assert from "node:assert/strict";
import test from "node:test";
import { commandText, describeArgs, firstLine, pickCommand } from "./tools.ts";

test("firstLine returns the first non-empty trimmed line", () => {
  assert.equal(firstLine(""), "");
  assert.equal(firstLine("   \n\n"), "");
  assert.equal(firstLine("hello"), "hello");
  assert.equal(firstLine("  hello  "), "hello");
  assert.equal(firstLine("\n  skipped\nkept"), "skipped");
  assert.equal(firstLine("\r\n\r\n  second  \r\nthird"), "second");
  assert.equal(firstLine("only\r\n"), "only");
});

test("describeArgs joins argv-style shell commands", () => {
  assert.deepEqual(describeArgs("Shell", { command: ["npm", "run", "build"], working_directory: "/repo" }), {
    name: "Shell",
    kind: "shell",
    command: "npm run build",
    subject: "npm run build",
    cwd: "/repo",
  });
  assert.equal(pickCommand({ cmd: ["echo", "hi"] }, ["cmd"]), "echo hi");
  assert.equal(commandText(["a", 1, true]), "a 1 true");
  assert.equal(commandText("  x  "), "x");
  assert.equal(commandText([{ no: "pe" }]), "");
});
