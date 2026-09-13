import assert from "node:assert/strict";
import test from "node:test";
import { resolveConfigHome } from "./config-home.ts";

test("resolveConfigHome rejects blank and relative roots", () => {
  assert.equal(resolveConfigHome(undefined, "/fallback"), "/fallback");
  assert.equal(resolveConfigHome("  ", "/fallback"), "/fallback");
  assert.equal(resolveConfigHome("./evil", "/fallback"), "/fallback");
  assert.equal(resolveConfigHome("/abs/config", "/fallback"), "/abs/config");
});
