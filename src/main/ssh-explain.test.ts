import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeRemotePath } from "./ssh-explain.ts";

test("assertSafeRemotePath rejects empty, controls, and lone dash", () => {
  assert.doesNotThrow(() => assertSafeRemotePath("/home/me/src"));
  assert.doesNotThrow(() => assertSafeRemotePath("C:\\Users\\me\\src"));
  assert.throws(() => assertSafeRemotePath(""), /路径不合法/);
  assert.throws(() => assertSafeRemotePath("-"), /路径不合法/);
  assert.throws(() => assertSafeRemotePath("a\nb"), /路径不合法/);
});
