import assert from "node:assert/strict";
import test from "node:test";
import { deviceCheckStillCurrent, deviceConnectionKey } from "./device-check.ts";

test("deviceConnectionKey ignores default ssh port spelling", () => {
  assert.equal(
    deviceConnectionKey({ host: "box", port: undefined }),
    deviceConnectionKey({ host: "box", port: 22 }),
  );
  assert.notEqual(
    deviceConnectionKey({ host: "box", port: 2222 }),
    deviceConnectionKey({ host: "box", port: 22 }),
  );
  assert.notEqual(
    deviceConnectionKey({ host: "old" }),
    deviceConnectionKey({ host: "new" }),
  );
  assert.notEqual(
    deviceConnectionKey({ host: "box", user: "a" }),
    deviceConnectionKey({ host: "box", user: "b" }),
  );
});

test("deviceCheckStillCurrent rejects stale epoch, removed device, and host edits", () => {
  const device = { host: "192.168.1.8", user: "cea", port: 22 as number | undefined };
  const expectedKey = deviceConnectionKey(device);
  assert.equal(
    deviceCheckStillCurrent({ epoch: 1, currentEpoch: 1, device, expectedKey }),
    true,
  );
  assert.equal(
    deviceCheckStillCurrent({ epoch: 1, currentEpoch: 2, device, expectedKey }),
    false,
  );
  assert.equal(
    deviceCheckStillCurrent({ epoch: 1, currentEpoch: 1, device: undefined, expectedKey }),
    false,
  );
  assert.equal(
    deviceCheckStillCurrent({
      epoch: 1,
      currentEpoch: 1,
      device: { ...device, host: "10.0.0.2" },
      expectedKey,
    }),
    false,
  );
});
