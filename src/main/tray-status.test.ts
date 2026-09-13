import assert from "node:assert/strict";
import test from "node:test";
import {
  countRunStatuses,
  sanitizeTrayHost,
  trayAgentLabel,
  trayHostLabel,
  trayPhonesLabel,
  trayStatusSignature,
  trayTooltip,
} from "./tray-status.ts";

test("countRunStatuses tallies running and queued in one pass", () => {
  assert.deepEqual(countRunStatuses([]), { running: 0, queued: 0 });
  assert.deepEqual(
    countRunStatuses([
      { status: "running" },
      { status: "queued" },
      { status: "succeeded" },
      { status: "running" },
      { status: "failed" },
      { status: "queued" },
    ]),
    { running: 2, queued: 2 },
  );
});

test("tray labels stay Chinese and idle when empty", () => {
  assert.equal(trayAgentLabel(0, 0), "Agent 空闲");
  assert.equal(trayAgentLabel(1, 0), "Agent：1 运行中 · 0 排队");
  assert.equal(trayAgentLabel(0, 2), "Agent：0 运行中 · 2 排队");
  assert.equal(trayPhonesLabel(0), "没有手机在线");
  assert.equal(trayPhonesLabel(3), "3 台手机在线");
  assert.equal(trayHostLabel(undefined, 7788), "未发现局域网地址");
  assert.equal(trayHostLabel("192.168.1.8", 7788), "192.168.1.8:7788");
});

test("trayStatusSignature changes only when a status row would change", () => {
  const a = trayStatusSignature("192.168.1.8", 7788, 1, 0, 0);
  assert.equal(trayStatusSignature("192.168.1.8", 7788, 1, 0, 0), a);
  assert.notEqual(trayStatusSignature("192.168.1.8", 7788, 1, 1, 0), a);
  assert.notEqual(trayStatusSignature(undefined, 7788, 1, 0, 0), a);
});

test("trayTooltip joins Chinese status rows", () => {
  assert.equal(trayTooltip(0, 0, 0), "Nearbox · Agent 空闲 · 没有手机在线");
  assert.equal(trayTooltip(1, 2, 3), "Nearbox · Agent：1 运行中 · 2 排队 · 3 台手机在线");
});


test("tray host labels strip control characters and empty after sanitize", () => {
  assert.equal(sanitizeTrayHost("  192.168.1.8\n "), "192.168.1.8");
  assert.equal(sanitizeTrayHost("\u0001\u0002"), undefined);
  assert.equal(trayHostLabel("192.168.1.8\n", 7788), "192.168.1.8:7788");
  assert.equal(trayHostLabel("\t", 7788), "未发现局域网地址");
});
