import assert from "node:assert/strict";
import test from "node:test";
import { resolveConfigHome } from "./config-home.ts";

test("resolveConfigHome requires a non-empty absolute path", () => {
  assert.equal(resolveConfigHome(undefined, "/fallback"), "/fallback");
  assert.equal(resolveConfigHome("", "/fallback"), "/fallback");
  assert.equal(resolveConfigHome("   ", "/fallback"), "/fallback");
  assert.equal(resolveConfigHome("relative/path", "/fallback"), "/fallback");
  assert.equal(resolveConfigHome("./evil", "/fallback"), "/fallback");
  assert.equal(resolveConfigHome("/abs/config", "/fallback"), "/abs/config");
  if (process.platform === "win32") {
    assert.equal(resolveConfigHome("C:\\Users\\x\\AppData\\Roaming", "D:\\fb"), "C:\\Users\\x\\AppData\\Roaming");
  }
});
