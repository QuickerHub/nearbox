import assert from "node:assert/strict";
import test from "node:test";
import {
  localPreflightFailure,
  shouldAttemptWarm,
  warmFallbackStatus,
} from "./run-start.ts";

test("local preflight: missing CLI and missing cwd", () => {
  const missingCli = localPreflightFailure({
    agentLabel: "Cursor Agent",
    hasCommand: false,
    cwd: "C:\\proj",
    cwdExists: true,
  });
  assert.equal(missingCli?.reason, "cli-missing");
  assert.match(missingCli?.stderr ?? "", /Cursor Agent/);
  assert.equal(missingCli?.error, "未安装对应的 CLI");

  const missingCwd = localPreflightFailure({
    agentLabel: "Cursor Agent",
    hasCommand: true,
    cwd: "D:\\gone",
    cwdExists: false,
  });
  assert.equal(missingCwd?.reason, "cwd-missing");
  assert.match(missingCwd?.stderr ?? "", /D:\\gone/);
  assert.equal(missingCwd?.error, "项目目录不存在");

  assert.equal(
    localPreflightFailure({
      agentLabel: "Cursor Agent",
      hasCommand: true,
      cwd: "C:\\proj",
      cwdExists: true,
    }),
    null,
  );
});

test("warm attempt skips remote and delegation runs", () => {
  assert.deepEqual(shouldAttemptWarm({}), { attempt: true });
  assert.deepEqual(shouldAttemptWarm({ delegate: false }), { attempt: true });
  assert.deepEqual(shouldAttemptWarm({ deviceId: "pc-2" }), { attempt: false, reason: "remote" });
  assert.deepEqual(shouldAttemptWarm({ delegate: true }), { attempt: false, reason: "delegation" });
  // Remote wins the taxonomy even if both are set.
  assert.deepEqual(shouldAttemptWarm({ deviceId: "pc-2", delegate: true }), { attempt: false, reason: "remote" });
});

test("warm fallback status strings stay stable", () => {
  assert.match(warmFallbackStatus("host-down"), /常驻进程这次没起来/);
  assert.match(warmFallbackStatus("models-unknown"), /还没学到模型列表/);
  assert.match(warmFallbackStatus("model-unsupported", "gpt-x"), /gpt-x/);
  assert.match(warmFallbackStatus("legacy-session"), /改为新会话/);
  assert.match(warmFallbackStatus("session-error", "boom"), /boom/);
  assert.match(warmFallbackStatus("session-error"), /未知错误/);
});

test("local preflight prefers cli-missing over cwd-missing", () => {
  const both = localPreflightFailure({
    agentLabel: "Claude Code",
    hasCommand: false,
    cwd: "/gone",
    cwdExists: false,
  });
  assert.equal(both?.reason, "cli-missing");
  assert.match(both?.stderr ?? "", /Claude Code/);
});

test("warmFallbackStatus pins every taxonomy string", () => {
  assert.equal(
    warmFallbackStatus("host-down"),
    "常驻进程这次没起来，本轮用单独进程（结束就会退出）。",
  );
  assert.equal(
    warmFallbackStatus("models-unknown"),
    "常驻会话还没学到模型列表，本轮改用单独进程运行。",
  );
  assert.equal(
    warmFallbackStatus("model-unsupported", "gpt-x"),
    "常驻会话不支持模型 gpt-x，本轮改用单独进程运行。",
  );
  assert.equal(
    warmFallbackStatus("model-unsupported"),
    "常驻会话不支持模型 ，本轮改用单独进程运行。",
  );
  assert.equal(
    warmFallbackStatus("legacy-session"),
    "这段会话是在单独进程模式下开始的，常驻进程接不上，回复会慢一些；想要更快的回复可以「改为新会话」。",
  );
  assert.equal(
    warmFallbackStatus("session-error", "boom"),
    "常驻会话不可用（boom），本轮改用单独进程运行。",
  );
  assert.equal(
    warmFallbackStatus("session-error"),
    "常驻会话不可用（未知错误），本轮改用单独进程运行。",
  );
});
