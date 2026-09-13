import assert from "node:assert/strict";
import test from "node:test";
import { findLast } from "./findLast.ts";

test("findLast returns the last match without copying", () => {
  const items = [1, 2, 3, 4, 5];
  assert.equal(findLast(items, (n) => n % 2 === 0), 4);
  assert.equal(findLast(items, (n) => n > 10), undefined);
  assert.equal(findLast([], () => true), undefined);
  assert.equal(findLast(items, (_n, index) => index === 0), 1);
});

test("findLast prefers the newest when several match", () => {
  const notes = [
    { id: "a", kind: "text" },
    { id: "b", kind: "run" },
    { id: "c", kind: "text" },
    { id: "d", kind: "run" },
  ];
  assert.equal(findLast(notes, (note) => note.kind === "run")?.id, "d");
});
