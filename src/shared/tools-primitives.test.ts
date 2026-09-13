import assert from "node:assert/strict";
import test from "node:test";
import { asArray, basenameOf, compact, isRecord, looseJson, pickString } from "./tools.ts";

test("looseJson parses objects and salvages clipped key/value pairs", () => {
  assert.deepEqual(looseJson('{"a":1}'), { a: 1 });
  assert.deepEqual(looseJson('  {"path":"/tmp/x"}  '), { path: "/tmp/x" });
  // Truncated JSON: recover complete string pairs only.
  assert.deepEqual(looseJson('{"cmd":"ls","arg":"he'), { cmd: "ls" });
  assert.equal(looseJson("[1,2]"), null);
  assert.equal(looseJson("not json"), null);
  assert.equal(looseJson(""), null);
  assert.equal(looseJson("null"), null);
  assert.equal(looseJson('{"a":'), null);
});

test("isRecord and asArray are narrow and tolerant", () => {
  assert.equal(isRecord({ a: 1 }), true);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord([1]), false);
  assert.equal(isRecord("x"), false);
  assert.deepEqual(asArray([1, 2]), [1, 2]);
  assert.deepEqual(asArray(undefined), []);
  assert.deepEqual(asArray("nope"), []);
  assert.deepEqual(asArray({ 0: "a", length: 1 }), []);
});

test("pickString returns the first non-empty string key as-is", () => {
  assert.equal(pickString({ title: "A", name: "B" }, ["name", "title"]), "B");
  assert.equal(pickString({ title: "  ", name: "B" }, ["title", "name"]), "B");
  assert.equal(pickString({ title: 1, name: "B" }, ["title", "name"]), "B");
  assert.equal(pickString({}, ["title", "name"]), "");
  assert.equal(pickString({ title: " keep " }, ["title"]), " keep ");
});

test("basenameOf strips directories on both slash styles", () => {
  assert.equal(basenameOf("a/b/c.txt"), "c.txt");
  assert.equal(basenameOf("a\\b\\c.txt"), "c.txt");
  assert.equal(basenameOf("c.txt"), "c.txt");
  assert.equal(basenameOf("a/b/"), "b");
  assert.equal(basenameOf(""), "");
});

test("compact keeps strings and JSON-stringifies other values", () => {
  assert.equal(compact(null), "null");
  assert.equal(compact(" hi "), " hi ");
  assert.equal(compact(3), "3");
  assert.equal(compact(true), "true");
  assert.equal(compact({ a: 1 }), '{"a":1}');
  assert.equal(compact([1, 2]), "[1,2]");
  assert.equal(compact(undefined), undefined);
});
