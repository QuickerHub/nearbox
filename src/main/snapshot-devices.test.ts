import assert from "node:assert/strict";
import test from "node:test";
import { countOnlinePhones, reuseMapValues } from "./snapshot-devices.ts";

test("countOnlinePhones ignores desktop and offline phones", () => {
  assert.equal(
    countOnlinePhones([
      { role: "desktop", online: true },
      { role: "phone", online: true },
      { role: "phone", online: false },
      { role: "phone", online: true },
    ]),
    2,
  );
});

test("reuseMapValues keeps the same array until the revision bumps", () => {
  const first = reuseMapValues(1, null, () => [{ id: "a" }, { id: "b" }]);
  const again = reuseMapValues(1, first, () => {
    throw new Error("should not rebuild");
  });
  assert.equal(again, first);
  assert.equal(again.values, first.values);

  const bumped = reuseMapValues(2, first, () => [{ id: "a" }]);
  assert.notEqual(bumped, first);
  assert.equal(bumped.revision, 2);
  assert.equal(bumped.values.length, 1);
});
