import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeIdentityFile, sanitizeRemoteHome } from "./ssh-explain.ts";

test("sanitizeRemoteHome keeps a normal home and rejects traversal", () => {
  assert.equal(sanitizeRemoteHome("/home/alice"), "/home/alice");
  assert.equal(sanitizeRemoteHome("C:\\Users\\alice"), "C:\\Users\\alice");
  assert.equal(sanitizeRemoteHome(""), "");
  assert.equal(sanitizeRemoteHome(undefined), "");
  assert.throws(() => sanitizeRemoteHome("/home/alice/../root"), /路径不合法/);
  assert.throws(() => sanitizeRemoteHome("C:\\Users\\alice\\..\\..\\Windows"), /路径不合法/);
  assert.throws(() => sanitizeRemoteHome("/home/alice\n/etc"), /路径不合法/);
});

test("assertSafeIdentityFile rejects option-like and control-laden paths", () => {
  assert.doesNotThrow(() => assertSafeIdentityFile("/home/alice/.ssh/id_ed25519"));
  assert.doesNotThrow(() => assertSafeIdentityFile("C:\\Users\\alice\\.ssh\\id_rsa"));
  assert.throws(() => assertSafeIdentityFile("-oProxyCommand=evil"), /密钥文件路径不合法/);
  assert.throws(() => assertSafeIdentityFile("/tmp/id\n-oProxyCommand=evil"), /密钥文件路径不合法/);
  assert.throws(() => assertSafeIdentityFile("   "), /密钥文件路径不合法/);
});
