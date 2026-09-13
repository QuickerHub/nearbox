import assert from "node:assert/strict";
import test from "node:test";
import {
  CANCEL_GRACE_MS,
  FORCE_CANCEL_GRACE_MS,
  cancelStartingStatus,
  cancelStoppingProcessStatus,
  markCancelling,
  warmCancelAfterSoftGrace,
  warmStartupSessionToClose,
} from "./cancel-escalation.ts";

test("warm cancel after soft grace: shared abandons, sole-user forces then kills", () => {
  assert.deepEqual(warmCancelAfterSoftGrace(true), { action: "abandon-keep-host" });
  assert.deepEqual(warmCancelAfterSoftGrace(false), { action: "force-then-kill" });
  assert.ok(CANCEL_GRACE_MS > FORCE_CANCEL_GRACE_MS);
  assert.ok(FORCE_CANCEL_GRACE_MS > 0);
});

test("markCancelling is once-only so Stop cannot stack warm timelines", () => {
  const state = { cancelled: false };
  assert.equal(markCancelling(state), true);
  assert.equal(state.cancelled, true);
  assert.equal(markCancelling(state), false);
  assert.equal(state.cancelled, true);
});

test("cancel status distinguishes pre-spawn from process kill", () => {
  assert.equal(cancelStartingStatus("已取消"), "已取消，正在取消…");
  assert.equal(cancelStoppingProcessStatus("已取消"), "已取消，正在停止进程…");
});

test("warmStartupSessionToClose only releases brand-new sessions", () => {
  assert.equal(warmStartupSessionToClose("sess-1", false), "sess-1");
  assert.equal(warmStartupSessionToClose("sess-1", true), undefined);
  assert.equal(warmStartupSessionToClose(undefined, false), undefined);
  assert.equal(warmStartupSessionToClose("", false), undefined);
});
