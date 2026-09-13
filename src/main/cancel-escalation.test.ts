import assert from "node:assert/strict";
import test from "node:test";
import { CANCEL_GRACE_MS, FORCE_CANCEL_GRACE_MS, warmCancelAfterSoftGrace } from "./cancel-escalation.ts";

test("warm cancel after soft grace: shared abandons, sole-user forces then kills", () => {
  assert.deepEqual(warmCancelAfterSoftGrace(true), { action: "abandon-keep-host" });
  assert.deepEqual(warmCancelAfterSoftGrace(false), { action: "force-then-kill" });
  assert.ok(CANCEL_GRACE_MS > FORCE_CANCEL_GRACE_MS);
  assert.ok(FORCE_CANCEL_GRACE_MS > 0);
});
