import assert from "node:assert/strict";
import test from "node:test";
import { countChanges, diffLines, unifiedDiff } from "./diff.ts";

const FILE = ["import x from 'x';", "", "export function a() {", "  return 1;", "}", "", "export function b() {", "  return 2;", "}", ""].join("\n");

test("a one-line change in a whole file becomes one small hunk", () => {
  const diff = unifiedDiff(FILE, FILE.replace("return 2", "return 3"));
  assert.equal(
    diff,
    ["@@ -5,5 +5,5 @@", " }", " ", " export function b() {", "-  return 2;", "+  return 3;", " }"].join("\n"),
  );
  assert.deepEqual(countChanges(diff), { added: 1, removed: 1 });
});

test("changes far apart get separate hunks with correct line numbers", () => {
  const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);
  const changed = [...lines];
  changed[1] = "line 2 changed";
  changed.splice(30, 0, "inserted");
  const diff = unifiedDiff(`${lines.join("\n")}\n`, `${changed.join("\n")}\n`);
  const headers = diff.split("\n").filter((line) => line.startsWith("@@"));
  assert.deepEqual(headers, ["@@ -1,5 +1,5 @@", "@@ -28,6 +28,7 @@"]);
  assert.deepEqual(countChanges(diff), { added: 2, removed: 1 });
});

test("new and deleted files are all additions or all removals", () => {
  assert.equal(unifiedDiff("", "a\nb\n"), "@@ -0,0 +1,2 @@\n+a\n+b");
  assert.equal(unifiedDiff("a\nb\n", ""), "@@ -1,2 +0,0 @@\n-a\n-b");
  assert.equal(unifiedDiff("same\n", "same\n"), "");
});

test("a trailing newline only counts when the two sides disagree about it", () => {
  assert.equal(unifiedDiff("a\nb", "a\nb\n"), "@@ -1,2 +1,3 @@\n a\n b\n+");
  assert.equal(unifiedDiff("a\r\nb\r\n", "a\nb\n"), "");
});

test("the edit script is minimal and keeps order", () => {
  const ops = diffLines(["a", "b", "c", "d", "e"], ["a", "c", "d", "x", "e"]);
  assert.deepEqual(
    ops.map((op) => `${op.tag}:${op.text}`),
    ["eq:a", "del:b", "eq:c", "eq:d", "add:x", "eq:e"],
  );
  // Moves are a deletion plus an insertion.
  const moved = diffLines(["a", "b", "c"], ["b", "c", "a"]);
  assert.equal(moved.filter((op) => op.tag === "del").length, 1);
  assert.equal(moved.filter((op) => op.tag === "add").length, 1);
});

test("a full rewrite of a large file still comes back quickly", () => {
  const before = Array.from({ length: 6000 }, (_, index) => `old ${index}`);
  const after = Array.from({ length: 6000 }, (_, index) => `new ${index}`);
  const started = Date.now();
  const ops = diffLines(before, after);
  assert.ok(Date.now() - started < 2000);
  assert.equal(ops.filter((op) => op.tag === "del").length, 6000);
  assert.equal(ops.filter((op) => op.tag === "add").length, 6000);
});

test("counts ignore file headers but not lines that merely start with dashes", () => {
  const diff = ["--- a/x.sql", "+++ b/x.sql", "@@ -1,2 +1,2 @@", "--- old comment", "+-- new comment", " select 1;"].join("\n");
  assert.deepEqual(countChanges(diff), { added: 1, removed: 1 });
});
