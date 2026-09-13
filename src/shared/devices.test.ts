import assert from "node:assert/strict";
import test from "node:test";
import { countOnlinePhones, phonesOnlineLabel } from "./devices.ts";

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
  assert.equal(countOnlinePhones([]), 0);
});

test("phonesOnlineLabel matches tray / board Chinese copy", () => {
  assert.equal(phonesOnlineLabel(0), "没有手机在线");
  assert.equal(phonesOnlineLabel(1), "1 台手机在线");
  assert.equal(phonesOnlineLabel(3), "3 台手机在线");
});

test("countOnlinePhones treats missing online as offline", () => {
  assert.equal(countOnlinePhones([{ role: "phone" }, { role: "phone", online: true }]), 1);
});
