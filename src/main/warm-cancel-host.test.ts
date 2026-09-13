import assert from "node:assert/strict";
import test from "node:test";
import { CANCEL_GRACE_MS, FORCE_CANCEL_GRACE_MS } from "./cancel-escalation.ts";
import { settlePermissionsOnCancel } from "./cancel-permission.ts";
import type { PermissionWaiter } from "./permission-queue.ts";
import { startWarmCancelOnHost, type WarmCancelHostSurface } from "./warm-cancel-host.ts";

type Call = string;

function fakeHost(): WarmCancelHostSurface & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    cancel(sessionId) {
      calls.push(`cancel:${sessionId}`);
    },
    forceCancel(sessionId) {
      calls.push(`forceCancel:${sessionId}`);
    },
    abandonPrompt(sessionId) {
      calls.push(`abandonPrompt:${sessionId}`);
    },
    kill() {
      calls.push("kill");
    },
  };
}

/** Collect scheduled timers; fire them in order by advancing `ms`. */
function fakeSchedule() {
  const queue: Array<{ at: number; fn: () => void }> = [];
  let now = 0;
  const schedule = (ms: number, fn: () => void) => {
    queue.push({ at: now + ms, fn });
    queue.sort((a, b) => a.at - b.at);
  };
  const advance = (ms: number) => {
    const target = now + ms;
    while (queue.length && queue[0]!.at <= target) {
      const next = queue.shift()!;
      now = next.at;
      next.fn();
    }
    now = target;
  };
  return { schedule, advance, pending: () => queue.length };
}

test("fake host sole-user: soft → force → abandon+kill on grace timers", () => {
  const host = fakeHost();
  const { schedule, advance, pending } = fakeSchedule();
  let active = true;
  const notes: string[] = [];

  startWarmCancelOnHost(host, "sess-1", schedule, {
    settlePermissions() {
      notes.push("settle");
    },
    isStillActive: () => active,
    isSharedHost: () => false,
    onAbandonKeepHost() {
      notes.push("keep");
    },
    onForceCancel() {
      notes.push("force");
    },
  });

  assert.deepEqual(notes, ["settle"]);
  assert.deepEqual(host.calls, ["cancel:sess-1"]);
  assert.equal(pending(), 1);

  advance(CANCEL_GRACE_MS - 1);
  assert.deepEqual(host.calls, ["cancel:sess-1"]);

  advance(1);
  assert.deepEqual(host.calls, ["cancel:sess-1", "forceCancel:sess-1"]);
  assert.deepEqual(notes, ["settle", "force"]);
  assert.equal(pending(), 1);

  advance(FORCE_CANCEL_GRACE_MS);
  assert.deepEqual(host.calls, ["cancel:sess-1", "forceCancel:sess-1", "abandonPrompt:sess-1", "kill"]);
  assert.equal(pending(), 0);
});

test("fake host shared: soft → abandon-keep-host; never force or kill", () => {
  const host = fakeHost();
  const { schedule, advance, pending } = fakeSchedule();
  let active = true;
  let kept = false;

  startWarmCancelOnHost(host, "sess-2", schedule, {
    settlePermissions() {},
    isStillActive: () => active,
    isSharedHost: () => true,
    onAbandonKeepHost() {
      kept = true;
      active = false;
    },
  });

  assert.deepEqual(host.calls, ["cancel:sess-2"]);
  advance(CANCEL_GRACE_MS);
  assert.deepEqual(host.calls, ["cancel:sess-2", "abandonPrompt:sess-2"]);
  assert.equal(kept, true);
  assert.equal(pending(), 0);
  advance(FORCE_CANCEL_GRACE_MS + CANCEL_GRACE_MS);
  assert.deepEqual(host.calls, ["cancel:sess-2", "abandonPrompt:sess-2"]);
});

test("sharedness is re-checked at soft grace (joined mid-wait → keep host)", () => {
  const host = fakeHost();
  const { schedule, advance } = fakeSchedule();
  let shared = false;
  let kept = false;

  startWarmCancelOnHost(host, "sess-join", schedule, {
    settlePermissions() {},
    isStillActive: () => true,
    isSharedHost: () => shared,
    onAbandonKeepHost() {
      kept = true;
    },
    onForceCancel() {
      kept = false;
    },
  });

  // Alone at Stop; another warm turn joins the same host during grace.
  shared = true;
  advance(CANCEL_GRACE_MS);
  assert.equal(kept, true);
  assert.deepEqual(host.calls, ["cancel:sess-join", "abandonPrompt:sess-join"]);
  assert.ok(!host.calls.includes("kill"));
});

test("timers no-op when the turn finishes before soft grace", () => {
  const host = fakeHost();
  const { schedule, advance } = fakeSchedule();
  let active = true;

  startWarmCancelOnHost(host, "sess-3", schedule, {
    settlePermissions() {},
    isStillActive: () => active,
    isSharedHost: () => false,
    onAbandonKeepHost() {},
  });

  active = false;
  advance(CANCEL_GRACE_MS + FORCE_CANCEL_GRACE_MS);
  assert.deepEqual(host.calls, ["cancel:sess-3"]);
});

test("soft-cancel settles permission queue before host.cancel", () => {
  const host = fakeHost();
  const { schedule } = fakeSchedule();
  const order: string[] = [];
  const queue: PermissionWaiter<{ id: string }>[] = [
    {
      pending: { id: "a" },
      resolve(id) {
        order.push(`resolve:${id}`);
      },
    },
    {
      pending: { id: "b" },
      resolve(id) {
        order.push(`resolve:${id}`);
      },
    },
  ];

  startWarmCancelOnHost(host, "sess-4", schedule, {
    settlePermissions() {
      order.push("settle-start");
      settlePermissionsOnCancel(queue);
      order.push("settle-done");
    },
    isStillActive: () => true,
    isSharedHost: () => true,
    onAbandonKeepHost() {
      order.push("keep");
    },
  });

  order.push(`host:${host.calls[0]}`);
  assert.deepEqual(order, ["settle-start", "resolve:null", "resolve:null", "settle-done", "host:cancel:sess-4"]);
  assert.equal(queue.length, 0);
});
