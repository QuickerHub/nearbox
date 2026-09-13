import assert from "node:assert/strict";
import test from "node:test";
import { hrefFor, parseRoute, type Route } from "./router.ts";

test("parseRoute maps current and legacy hashes", () => {
  assert.deepEqual(parseRoute(""), { name: "home" });
  assert.deepEqual(parseRoute("#/"), { name: "home" });
  assert.deepEqual(parseRoute("#"), { name: "home" });
  assert.deepEqual(parseRoute("#/inbox"), { name: "home" });
  assert.deepEqual(parseRoute("#/tasks"), { name: "home" });
  assert.deepEqual(parseRoute("#/task/abc"), { name: "task", id: "abc" });
  assert.deepEqual(parseRoute("#/task/"), { name: "home" });
  assert.deepEqual(parseRoute("#/run/r1"), { name: "run", id: "r1" });
  assert.deepEqual(parseRoute("#/run"), { name: "home" });
  assert.deepEqual(parseRoute("#/remote"), { name: "remote" });
  assert.deepEqual(parseRoute("#/settings"), { name: "settings" });
  assert.deepEqual(parseRoute("#/projects"), { name: "settings" });
});

test("parseRoute decodes ids and ignores query strings", () => {
  assert.deepEqual(parseRoute("#/task/a%2Fb%20c"), { name: "task", id: "a/b c" });
  assert.deepEqual(parseRoute("#/run/r%3A1?tab=events"), { name: "run", id: "r:1" });
  assert.deepEqual(parseRoute("#/settings?focus=agents"), { name: "settings" });
});

test("hrefFor round-trips with parseRoute", () => {
  const routes: Route[] = [
    { name: "home" },
    { name: "task", id: "t1" },
    { name: "task", id: "a/b c" },
    { name: "run", id: "r:1" },
    { name: "remote" },
    { name: "settings" },
  ];
  for (const route of routes) {
    assert.deepEqual(parseRoute(hrefFor(route)), route);
  }
  assert.equal(hrefFor({ name: "home" }), "#/");
  assert.equal(hrefFor({ name: "task", id: "a/b" }), "#/task/a%2Fb");
});
