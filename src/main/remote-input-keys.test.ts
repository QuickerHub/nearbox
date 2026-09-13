import assert from "node:assert/strict";
import test from "node:test";
import {
  buttonCommand,
  clampUnit,
  codeToVk,
  hWheelCommand,
  keyCommand,
  wheelCommand,
} from "./remote-input.ts";

test("clampUnit keeps [0,1] and maps non-finite to 0", () => {
  assert.equal(clampUnit(0), 0);
  assert.equal(clampUnit(1), 1);
  assert.equal(clampUnit(0.25), 0.25);
  assert.equal(clampUnit(-0.5), 0);
  assert.equal(clampUnit(2), 1);
  assert.equal(clampUnit(Number.NaN), 0);
  assert.equal(clampUnit(Number.POSITIVE_INFINITY), 0);
});

test("buttonCommand maps left/right/middle to injector codes", () => {
  assert.equal(buttonCommand("left", true), "B 1 1");
  assert.equal(buttonCommand("left", false), "B 1 0");
  assert.equal(buttonCommand("right", true), "B 2 1");
  assert.equal(buttonCommand("middle", false), "B 3 0");
});

test("keyCommand encodes vk, down, and extended flag", () => {
  assert.equal(keyCommand(0x41, true, false), "K 65 1 0");
  assert.equal(keyCommand(0x25, false, true), "K 37 0 1");
});

test("wheel helpers drop zero/NaN and keep signed 120-unit steps", () => {
  assert.equal(wheelCommand(Number.NaN), null);
  assert.equal(hWheelCommand(Number.NaN), null);
  assert.equal(hWheelCommand(0), null);
  assert.equal(hWheelCommand(1), "H 120");
  assert.equal(hWheelCommand(-2), "H -240");
  assert.equal(wheelCommand(0.4), "W 48");
});

test("codeToVk covers punctuation, media keys, and high F-keys", () => {
  assert.deepEqual(codeToVk("Minus"), { vk: 0xbd, extended: false });
  assert.deepEqual(codeToVk("Equal"), { vk: 0xbb, extended: false });
  assert.deepEqual(codeToVk("BracketLeft"), { vk: 0xdb, extended: false });
  assert.deepEqual(codeToVk("Comma"), { vk: 0xbc, extended: false });
  assert.deepEqual(codeToVk("F1"), { vk: 0x70, extended: false });
  assert.deepEqual(codeToVk("F24"), { vk: 0x87, extended: false });
  assert.equal(codeToVk("F25"), null);
  assert.deepEqual(codeToVk("AudioVolumeMute"), { vk: 0xad, extended: false });
  assert.deepEqual(codeToVk("MediaPlayPause"), { vk: 0xb3, extended: false });
  assert.deepEqual(codeToVk("NumpadEnter"), { vk: 0x0d, extended: true });
  assert.deepEqual(codeToVk("ControlRight"), { vk: 0xa3, extended: true });
  assert.deepEqual(codeToVk("PrintScreen"), { vk: 0x2c, extended: true });
});
