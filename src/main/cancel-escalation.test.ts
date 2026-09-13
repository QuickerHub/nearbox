import assert from "node:assert/strict";
import test from "node:test";
import {
  CANCEL_GRACE_MS,
  FORCE_CANCEL_GRACE_MS,
  cancelRunAction,
  cancelStartingStatus,
  cancelStoppingProcessStatus,
  markCancelling,
  warmCancelAfterSoftGrace,
  warmHostAfterLookup,
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

test("cancelRunAction: remote prepare without child is starting, not stop-remote", () => {
  assert.equal(cancelRunAction({ warm: { host: 1 } }), "warm-host");
  assert.equal(cancelRunAction({ remote: { pidFile: "x" }, child: {} }), "stop-remote");
  // Early remote bind during upload / cwd check — nothing running yet.
  assert.equal(cancelRunAction({ remote: { pidFile: "x" } }), "starting");
  assert.equal(cancelRunAction({ child: {} }), "stop-local");
  assert.equal(cancelRunAction({}), "starting");
});

test("warmHostAfterLookup: Stop wins over host-down fallback", () => {
  assert.equal(warmHostAfterLookup(true, false), "cancel");
  assert.equal(warmHostAfterLookup(true, true), "cancel");
  assert.equal(warmHostAfterLookup(false, false), "fallback");
  assert.equal(warmHostAfterLookup(false, true), "continue");
});

test("cancelRunAction prefers warm over remote/local handles", () => {
  assert.equal(cancelRunAction({ warm: {}, remote: {}, child: {} }), "warm-host");
  assert.equal(cancelRunAction({ warm: {}, child: {} }), "warm-host");
});

test("markCancelling then cancelRunAction still reports starting until handles attach", () => {
  const state = { cancelled: false };
  assert.equal(markCancelling(state), true);
  assert.equal(cancelRunAction({}), "starting");
  assert.equal(cancelStartingStatus("已取消"), "已取消，正在取消…");
});

test("warmHostAfterLookup cancel beats both available and missing host", () => {
  // Second Stop / cascade: cancelled flag already set before host() returns.
  assert.equal(warmHostAfterLookup(true, true), "cancel");
  assert.equal(warmHostAfterLookup(true, false), "cancel");
});
