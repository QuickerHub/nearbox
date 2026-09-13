import assert from "node:assert/strict";
import test from "node:test";
import { remoteCwdPreflight, remoteDevicePreflight } from "./remote-preflight.ts";
import { assertSafeRemotePath, describeTarget, explainSshFailure, isSshUser } from "./ssh-explain.ts";

test("remote device preflight: missing agent and missing home", () => {
  const missingAgent = remoteDevicePreflight({
    deviceName: "书房",
    agentLabel: "Cursor Agent",
    agentAvailable: false,
    hasHome: true,
  });
  assert.equal(missingAgent?.reason, "agent-missing");
  assert.match(missingAgent?.stderr ?? "", /书房.*Cursor Agent/);
  assert.equal(missingAgent?.error, "书房 上未安装对应的 CLI");

  const missingHome = remoteDevicePreflight({
    deviceName: "书房",
    agentLabel: "Cursor Agent",
    agentAvailable: true,
    hasHome: false,
  });
  assert.equal(missingHome?.reason, "home-missing");
  assert.match(missingHome?.stderr ?? "", /用户目录/);
  assert.equal(missingHome?.error, "设备信息不完整");

  assert.equal(
    remoteDevicePreflight({
      deviceName: "书房",
      agentLabel: "Cursor Agent",
      agentAvailable: true,
      hasHome: true,
    }),
    null,
  );
});

test("remote cwd preflight", () => {
  const missing = remoteCwdPreflight({ deviceName: "书房", cwd: "D:\\gone", cwdExists: false });
  assert.equal(missing?.reason, "cwd-missing");
  assert.match(missing?.stderr ?? "", /D:\\gone/);
  assert.equal(missing?.error, "项目目录不存在");
  assert.equal(remoteCwdPreflight({ deviceName: "书房", cwd: "D:\\ok", cwdExists: true }), null);
});

test("explainSshFailure taxonomy covers auth, DNS, connect, and host-key", () => {
  const target = { host: "pc-2", user: "cea", port: 22 };
  assert.match(describeTarget(target), /cea@pc-2:22/);
  assert.match(explainSshFailure(target, "Permission denied (publickey)."), /免密登录/);
  assert.match(explainSshFailure({ host: "missing.lan" }, "ssh: Could not resolve hostname missing.lan"), /找不到主机/);
  assert.match(explainSshFailure(target, "ssh: connect to host pc-2 port 22: Connection refused"), /连不上/);
  assert.match(explainSshFailure(target, "WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!"), /主机密钥/);
  assert.match(explainSshFailure(target, "Connection reset by peer"), /连接被中断/);
  assert.match(explainSshFailure(target, "kex_exchange_identification: Connection closed by remote host"), /握手失败/);
  assert.match(explainSshFailure(target, "Something else failed"), /连接 cea@pc-2:22 失败/);
});

test("assertSafeRemotePath rejects empty and control characters", () => {
  assert.throws(() => assertSafeRemotePath(""), /路径不合法/);
  assert.throws(() => assertSafeRemotePath("a\nb"), /路径不合法/);
  assert.doesNotThrow(() => assertSafeRemotePath("C:\\Users\\cea\\proj"));
});

test("isSshUser rejects option-like and blank names", () => {
  assert.equal(isSshUser("cea"), true);
  assert.equal(isSshUser("domain\\user"), true);
  assert.equal(isSshUser("-l"), false);
  assert.equal(isSshUser("a b"), false);
  assert.equal(isSshUser(""), false);
});
