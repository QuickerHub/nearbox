import assert from "node:assert/strict";
import test from "node:test";
import { serializeState, stateTempPath } from "./store-serialize.ts";

test("serializeState round-trips plain state", () => {
  const raw = serializeState({ version: 1, tasks: [] });
  assert.equal(JSON.parse(raw).version, 1);
});

test("serializeState throws on cycles so callers can restore dirty", () => {
  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => serializeState(cyclic), /Converting circular structure|cyclic/i);
});

test("stateTempPath uses pid and clock so stuck .tmp files do not collide", () => {
  assert.equal(stateTempPath("/data/state.json", () => 42, 9), "/data/state.json.9-42.tmp");
  assert.notEqual(stateTempPath("/data/state.json", () => 1, 1), stateTempPath("/data/state.json", () => 2, 1));
});
