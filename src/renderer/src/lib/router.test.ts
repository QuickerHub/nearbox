import assert from "node:assert/strict";
import test from "node:test";
import { hrefFor, parseRoute, safeDecodeURIComponent } from "./router.ts";

test("parseRoute covers home, task, run, remote, settings aliases", () => {
  assert.deepEqual(parseRoute("#/"), { name: "home" });
  assert.deepEqual(parseRoute("#/task/abc"), { name: "task", id: "abc" });
  assert.deepEqual(parseRoute("#/task/hello%20world"), { name: "task", id: "hello world" });
  assert.deepEqual(parseRoute("#/run/r1"), { name: "run", id: "r1" });
  assert.deepEqual(parseRoute("#/remote"), { name: "remote" });
  assert.deepEqual(parseRoute("#/settings"), { name: "settings" });
  assert.deepEqual(parseRoute("#/projects"), { name: "settings" });
  assert.deepEqual(parseRoute("#/inbox"), { name: "home" });
});

test("malformed percent-encoding does not throw", () => {
  assert.equal(safeDecodeURIComponent("%ZZ"), "%ZZ");
  assert.deepEqual(parseRoute("#/task/%ZZ"), { name: "task", id: "%ZZ" });
  assert.deepEqual(parseRoute("#/run/%E0%A4%A"), { name: "run", id: "%E0%A4%A" });
});

test("hrefFor round-trips ids that need encoding", () => {
  assert.equal(hrefFor({ name: "task", id: "a/b" }), "#/task/a%2Fb");
  assert.deepEqual(parseRoute(hrefFor({ name: "task", id: "a/b" })), { name: "task", id: "a/b" });
});
