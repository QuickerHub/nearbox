import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeRemotePath, describeTarget, explainSshFailure } from "./ssh-explain.ts";

test("assertSafeRemotePath rejects control chars and Windows device paths", () => {
  assert.doesNotThrow(() => assertSafeRemotePath("/home/me/src"));
  assert.doesNotThrow(() => assertSafeRemotePath("D:\\source\\app"));
  assert.throws(() => assertSafeRemotePath("a\nb"), /路径不合法/);
  assert.throws(() => assertSafeRemotePath(""), /路径不合法/);
  assert.throws(() => assertSafeRemotePath("NUL"), /路径不合法/);
  assert.throws(() => assertSafeRemotePath("C:\\NUL"), /路径不合法/);
  assert.throws(() => assertSafeRemotePath("COM1.txt"), /路径不合法/);
  assert.throws(() => assertSafeRemotePath("\\\\.\\PhysicalDrive0"), /路径不合法/);
  assert.throws(() => assertSafeRemotePath("//?/C:/Windows"), /路径不合法/);
});

test("describeTarget and explainSshFailure stay readable", () => {
  assert.equal(describeTarget({ host: "box", user: "me", port: 2222 }), "me@box:2222");
  assert.match(explainSshFailure({ host: "box" }, "Permission denied (publickey)."), /免密登录/);
});
