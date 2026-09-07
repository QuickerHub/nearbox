import assert from "node:assert/strict";
import test from "node:test";
import {
  clampCrop,
  clampQuality,
  codeToVk,
  moveCommand,
  parseControlMessage,
  shouldSendFrame,
  textCommands,
  toAbsolute,
  translateInput,
  wheelCommand,
} from "./remote-input.ts";

test("normalized coordinates map onto the SendInput 0..65535 range and clamp", () => {
  assert.equal(toAbsolute(0), 0);
  assert.equal(toAbsolute(1), 65535);
  assert.equal(toAbsolute(0.5), 32768);
  assert.equal(toAbsolute(-3), 0);
  assert.equal(toAbsolute(7), 65535);
  assert.equal(toAbsolute(Number.NaN), 0);
  assert.equal(moveCommand(0.25, 0.75), "M 16384 49151");
});

test("pointer messages become move/button lines in order", () => {
  assert.deepEqual(translateInput({ t: "move", x: 0, y: 1 }), ["M 0 65535"]);
  assert.deepEqual(translateInput({ t: "down", button: "right", x: 0.5, y: 0.5 }), ["M 32768 32768", "B 2 1"]);
  assert.deepEqual(translateInput({ t: "up", button: "middle" }), ["B 3 0"]);
  assert.deepEqual(translateInput({ t: "click", button: "left", x: 0, y: 0 }), ["M 0 0", "B 1 1", "B 1 0"]);
  assert.deepEqual(translateInput({ t: "click", button: "left", double: true }), ["B 1 1", "B 1 0", "B 1 1", "B 1 0"]);
});

test("scroll notches turn into 120-unit wheel deltas and zero is dropped", () => {
  assert.equal(wheelCommand(1), "W 120");
  assert.equal(wheelCommand(-2.5), "W -300");
  assert.equal(wheelCommand(0), null);
  assert.deepEqual(translateInput({ t: "scroll", dy: -1, dx: 0.5 }), ["W -120", "H 60"]);
  assert.deepEqual(translateInput({ t: "scroll", dy: 0 }), []);
  assert.deepEqual(translateInput({ t: "scroll", x: 1, y: 1, dy: 1 }), ["M 65535 65535", "W 120"]);
});

test("DOM key codes resolve to Windows virtual keys with the extended flag where needed", () => {
  assert.deepEqual(codeToVk("KeyA"), { vk: 0x41, extended: false });
  assert.deepEqual(codeToVk("Digit7"), { vk: 0x37, extended: false });
  assert.deepEqual(codeToVk("Numpad3"), { vk: 0x63, extended: false });
  assert.deepEqual(codeToVk("F12"), { vk: 0x7b, extended: false });
  assert.deepEqual(codeToVk("Enter"), { vk: 0x0d, extended: false });
  assert.deepEqual(codeToVk("ArrowLeft"), { vk: 0x25, extended: true });
  assert.deepEqual(codeToVk("Delete"), { vk: 0x2e, extended: true });
  assert.deepEqual(codeToVk("MetaLeft"), { vk: 0x5b, extended: true });
  assert.equal(codeToVk("Unidentified"), null);
  assert.equal(codeToVk(""), null);
});

test("key and combo messages press and release in the right order", () => {
  assert.deepEqual(translateInput({ t: "key", code: "KeyA", down: true }), ["K 65 1 0"]);
  assert.deepEqual(translateInput({ t: "key", code: "ArrowDown", down: false }), ["K 40 0 1"]);
  assert.deepEqual(translateInput({ t: "key", code: "Nope", down: true }), []);
  assert.deepEqual(translateInput({ t: "combo", codes: ["ControlLeft", "KeyC"] }), ["K 162 1 0", "K 67 1 0", "K 67 0 0", "K 162 0 0"]);
  assert.deepEqual(translateInput({ t: "combo", codes: ["Bogus"] }), []);
});

test("text is typed one UTF-16 code unit at a time so Chinese and emoji survive", () => {
  assert.deepEqual(textCommands("Hi你"), ["U 72", "U 105", "U 20320"]);
  assert.deepEqual(translateInput({ t: "text", value: "😀" }), ["U 55357", "U 56832"]);
  assert.deepEqual(translateInput({ t: "text", value: "" }), []);
});

test("quality requests are clamped onto the current config", () => {
  const base = { quality: 55, fps: 12, maxWidth: 1440 };
  assert.deepEqual(clampQuality(undefined, base), base);
  assert.deepEqual(clampQuality({ quality: 200, fps: 0, maxWidth: 100 }, base), { quality: 95, fps: 1, maxWidth: 480 });
  assert.deepEqual(clampQuality({ fps: 20.4 }, base), { quality: 55, fps: 20, maxWidth: 1440 });
  assert.deepEqual(clampQuality({ quality: Number.NaN }, base), base);
});

test("a zoom crop is kept and a full-screen crop is dropped", () => {
  const base = { quality: 72, fps: 12, maxWidth: 1920 };
  assert.equal(clampCrop({ x: 0.2, y: 0.1, w: 0.4, h: 0.5 })?.w, 0.4);
  assert.equal(clampCrop({ x: 0, y: 0, w: 1, h: 1 }), undefined);
  assert.equal(clampCrop(null), undefined);
  const withCrop = clampQuality({ crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } }, base);
  assert.deepEqual(withCrop.crop, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  assert.equal(clampQuality({ crop: { x: 0, y: 0, w: 1, h: 1 } }, withCrop).crop, undefined);
  assert.deepEqual(clampQuality({ fps: 10 }, withCrop).crop, withCrop.crop);
});

test("frames are skipped for a viewer whose socket is backed up", () => {
  assert.equal(shouldSendFrame(0), true);
  assert.equal(shouldSendFrame(512 * 1024), true);
  assert.equal(shouldSendFrame(512 * 1024 + 1), false);
  assert.equal(shouldSendFrame(10, 5), false);
});

test("control messages are validated before they reach the injector", () => {
  assert.deepEqual(parseControlMessage('{"t":"move","x":0.1,"y":0.2}'), { t: "move", x: 0.1, y: 0.2 });
  assert.equal(parseControlMessage('{"t":"move","x":"0.1"}'), null);
  assert.equal(parseControlMessage("not json"), null);
  assert.equal(parseControlMessage('{"t":"format-disk"}'), null);
  assert.equal(parseControlMessage('{"t":"down","button":"nuke"}'), null);
  assert.deepEqual(parseControlMessage('{"t":"click","button":"left","x":0.5,"y":0.5,"double":true}'), {
    t: "click",
    button: "left",
    x: 0.5,
    y: 0.5,
    double: true,
  });
  assert.equal(parseControlMessage('{"t":"key","code":"KeyA"}'), null);
  assert.deepEqual(parseControlMessage('{"t":"combo","codes":["ControlLeft","KeyV"]}'), { t: "combo", codes: ["ControlLeft", "KeyV"] });
  assert.equal(parseControlMessage('{"t":"combo","codes":[1]}'), null);
  assert.deepEqual(parseControlMessage('{"t":"text","value":"hi"}'), { t: "text", value: "hi" });
  assert.deepEqual(parseControlMessage('{"t":"ping","ts":5}'), { t: "ping", ts: 5 });
  assert.deepEqual(parseControlMessage('{"t":"config","maxWidth":1920,"crop":{"x":0.1,"y":0.2,"w":0.3,"h":0.4}}'), {
    t: "config",
    quality: undefined,
    fps: undefined,
    maxWidth: 1920,
    crop: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
  });
});
