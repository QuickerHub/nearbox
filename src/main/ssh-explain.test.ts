import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeRemotePath, describeTarget, explainSshFailure } from "./ssh-explain.ts";

test("describeTarget joins user, host, and optional port", () => {
  assert.equal(describeTarget({ host: "devbox" }), "devbox");
  assert.equal(describeTarget({ host: "devbox", port: 22 }), "devbox:22");
  assert.equal(describeTarget({ host: "10.0.0.2", user: "cea" }), "cea@10.0.0.2");
  assert.equal(describeTarget({ host: "10.0.0.2", user: "cea", port: 2222 }), "cea@10.0.0.2:2222");
});

test("explainSshFailure maps auth failures to a pubkey hint", () => {
  const message = explainSshFailure(
    { host: "devbox", user: "cea" },
    "Warning: Permanently added 'devbox'\nPermission denied (publickey).",
  );
  assert.match(message, /SSH 免密登录 cea@devbox 失败/);
  assert.match(message, /Permission denied/);
  assert.match(message, /公钥登录/);
  // Warning lines are skipped when picking the detail line.
  assert.doesNotMatch(message, /Permanently added/);
});

test("explainSshFailure covers resolve / connect / host-key / handshake / reset", () => {
  assert.match(
    explainSshFailure({ host: "missing.local" }, "ssh: Could not resolve hostname missing.local"),
    /找不到主机 missing\.local/,
  );
  assert.match(
    explainSshFailure({ host: "pc", port: 22 }, "Connection timed out"),
    /连不上 pc:22/,
  );
  assert.match(
    explainSshFailure({ host: "pc", user: "cea" }, "REMOTE HOST IDENTIFICATION HAS CHANGED!"),
    /主机密钥和以前不一样/,
  );
  assert.match(
    explainSshFailure({ host: "pc" }, "kex_exchange_identification: Connection closed by remote host"),
    /SSH 握手失败/,
  );
  assert.match(
    explainSshFailure({ host: "pc", user: "cea" }, "Connection reset by peer"),
    /连接被中断/,
  );
});

test("explainSshFailure falls back to the first useful stderr line", () => {
  assert.equal(
    explainSshFailure({ host: "pc" }, "  weird vendor error  "),
    "连接 pc 失败：weird vendor error",
  );
  assert.equal(explainSshFailure({ host: "pc", user: "cea" }, "   "), "连接 cea@pc 失败。");
});

test("assertSafeRemotePath rejects empty and control characters", () => {
  assert.doesNotThrow(() => assertSafeRemotePath("/home/cea/proj"));
  assert.doesNotThrow(() => assertSafeRemotePath("C:\\Users\\cea\\proj"));
  assert.throws(() => assertSafeRemotePath(""), /路径不合法/);
  assert.throws(() => assertSafeRemotePath("   "), /路径不合法/);
  assert.throws(() => assertSafeRemotePath("a\nb"), /路径不合法/);
  assert.throws(() => assertSafeRemotePath("a\rb"), /路径不合法/);
  assert.throws(() => assertSafeRemotePath("a\u0000b"), /路径不合法/);
});
