import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { isPathInside } from "./path-inside.ts";

test("isPathInside allows root and nested files", () => {
  const root = resolve("/app/out/renderer");
  assert.equal(isPathInside(root, root), true);
  assert.equal(isPathInside(root, resolve(root, "index.html")), true);
  assert.equal(isPathInside(root, resolve(root, "assets", "app.js")), true);
});

test("isPathInside rejects parents and prefix-sibling escapes", () => {
  const root = resolve("/app/out/renderer");
  assert.equal(isPathInside(root, resolve(root, "..", "main", "index.js")), false);
  assert.equal(isPathInside(root, resolve("/app/out/renderer2/secret")), false);
  assert.equal(isPathInside(root, resolve("/etc/passwd")), false);
});
