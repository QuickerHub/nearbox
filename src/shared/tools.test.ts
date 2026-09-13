import assert from "node:assert/strict";
import test from "node:test";
import { describeArgs, firstLine, todoMark } from "./tools.ts";

test("firstLine returns the first non-empty trimmed line", () => {
  assert.equal(firstLine(""), "");
  assert.equal(firstLine("   \n\n"), "");
  assert.equal(firstLine("hello"), "hello");
  assert.equal(firstLine("  hello  "), "hello");
  assert.equal(firstLine("\n  skipped\nkept"), "skipped");
  assert.equal(firstLine("\r\n\r\n  second  \r\nthird"), "second");
  assert.equal(firstLine("only\r\n"), "only");
});

test("todoMark accepts done/complete/inProgress aliases", () => {
  assert.equal(todoMark("completed"), "☑");
  assert.equal(todoMark("done"), "☑");
  assert.equal(todoMark("complete"), "☑");
  assert.equal(todoMark("pending", true), "☑");
  assert.equal(todoMark("in_progress"), "◐");
  assert.equal(todoMark("in-progress"), "◐");
  assert.equal(todoMark("inProgress"), "◐");
  assert.equal(todoMark("active"), "◐");
  assert.equal(todoMark("pending"), "☐");
  assert.equal(todoMark(""), "☐");
});

test("describeArgs todo rows use status aliases instead of painting everything pending", () => {
  const call = describeArgs("TodoWrite", {
    todos: [
      { content: "one", status: "done" },
      { text: "two", status: "inProgress" },
      { title: "three", status: "pending" },
    ],
  });
  assert.equal(call.kind, "todo");
  assert.equal(call.subject, "3 项");
  assert.equal(call.output, "☑ one\n◐ two\n☐ three");
});
