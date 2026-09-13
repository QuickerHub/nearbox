import assert from "node:assert/strict";
import test from "node:test";
import { inviteMintStillCurrent } from "./invite-mint.ts";

test("inviteMintStillCurrent requires matching epoch and host", () => {
  assert.equal(
    inviteMintStillCurrent({ epoch: 1, currentEpoch: 1, host: "192.168.1.2", selectedHost: "192.168.1.2" }),
    true,
  );
  assert.equal(
    inviteMintStillCurrent({ epoch: 1, currentEpoch: 2, host: "192.168.1.2", selectedHost: "192.168.1.2" }),
    false,
  );
  assert.equal(
    inviteMintStillCurrent({ epoch: 1, currentEpoch: 1, host: "192.168.1.2", selectedHost: "10.0.0.2" }),
    false,
  );
  assert.equal(
    inviteMintStillCurrent({ epoch: 0, currentEpoch: 0, host: "", selectedHost: "" }),
    false,
  );
});
