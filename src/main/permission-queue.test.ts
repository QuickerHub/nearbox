import assert from "node:assert/strict";
import test from "node:test";
import {
  drainPermissionQueue,
  pendingPermissionView,
  settleAllPermissions,
  settlePermissionHead,
  settlePermissionHeadIfAsk,
  type PermissionWaiter,
} from "./permission-queue.ts";

type Pending = { askId: string; toolCallId: string; title: string };

test("pendingPermissionView exposes head and remaining count", () => {
  assert.deepEqual(pendingPermissionView([]), {});
  const one: PermissionWaiter<Pending>[] = [{ pending: { askId: "a1", toolCallId: "1", title: "a" }, resolve() {} }];
  assert.deepEqual(pendingPermissionView(one), { pending: { askId: "a1", toolCallId: "1", title: "a" } });
  const two: PermissionWaiter<Pending>[] = [
    { pending: { askId: "a1", toolCallId: "1", title: "a" }, resolve() {} },
    { pending: { askId: "a2", toolCallId: "2", title: "b" }, resolve() {} },
    { pending: { askId: "a3", toolCallId: "3", title: "c" }, resolve() {} },
  ];
  assert.deepEqual(pendingPermissionView(two), { pending: { askId: "a1", toolCallId: "1", title: "a" }, queued: 2 });
});

test("settlePermissionHead resolves FIFO and settleAll cancels the rest", () => {
  const resolved: Array<string | null> = [];
  const queue: PermissionWaiter<Pending>[] = [
    { pending: { askId: "a1", toolCallId: "1", title: "a" }, resolve: (id) => resolved.push(id) },
    { pending: { askId: "a2", toolCallId: "2", title: "b" }, resolve: (id) => resolved.push(id) },
    { pending: { askId: "a3", toolCallId: "3", title: "c" }, resolve: (id) => resolved.push(id) },
  ];
  settlePermissionHead(queue, "allow-once");
  assert.deepEqual(resolved, ["allow-once"]);
  assert.equal(queue.length, 2);
  assert.deepEqual(pendingPermissionView(queue), { pending: { askId: "a2", toolCallId: "2", title: "b" }, queued: 1 });
  settleAllPermissions(queue);
  assert.deepEqual(resolved, ["allow-once", null, null]);
  assert.equal(queue.length, 0);
  assert.deepEqual(pendingPermissionView(queue), {});
});

test("settlePermissionHeadIfAsk rejects stale askId so colliding optionIds cannot settle the next head", () => {
  const resolved: Array<string | null> = [];
  const queue: PermissionWaiter<Pending>[] = [
    { pending: { askId: "ask-head", toolCallId: "t1", title: "rm -rf /" }, resolve: (id) => resolved.push(id) },
    { pending: { askId: "ask-next", toolCallId: "t2", title: "npm test" }, resolve: (id) => resolved.push(id) },
  ];
  // Stale click still carrying the previous ask's id must not touch the new head.
  assert.equal(settlePermissionHeadIfAsk(queue, "ask-stale", "allow-once"), false);
  assert.deepEqual(resolved, []);
  assert.equal(queue.length, 2);

  assert.equal(settlePermissionHeadIfAsk(queue, "ask-head", "allow-once"), true);
  assert.deepEqual(resolved, ["allow-once"]);
  assert.equal(queue.length, 1);

  // Same optionId the user meant for the first ask must not auto-apply to the next.
  assert.equal(settlePermissionHeadIfAsk(queue, "ask-head", "allow-once"), false);
  assert.deepEqual(resolved, ["allow-once"]);
  assert.equal(settlePermissionHeadIfAsk(queue, "ask-next", "allow-once"), true);
  assert.deepEqual(resolved, ["allow-once", "allow-once"]);
  assert.equal(queue.length, 0);
});

test("drainPermissionQueue clears without resolving", () => {
  const resolved: Array<string | null> = [];
  const queue: PermissionWaiter<Pending>[] = [
    { pending: { askId: "a1", toolCallId: "1", title: "a" }, resolve: (id) => resolved.push(id) },
    { pending: { askId: "a2", toolCallId: "2", title: "b" }, resolve: (id) => resolved.push(id) },
  ];
  const drained = drainPermissionQueue(queue);
  assert.equal(queue.length, 0);
  assert.equal(drained.length, 2);
  assert.deepEqual(resolved, []);
  for (const waiter of drained) {
    waiter.resolve(null);
  }
  assert.deepEqual(resolved, [null, null]);
});

test("settlePermissionHeadIfAsk is a no-op on empty queue or after settleAll", () => {
  const empty: PermissionWaiter<Pending>[] = [];
  assert.equal(settlePermissionHeadIfAsk(empty, "any", "allow-once"), false);

  const resolved: Array<string | null> = [];
  const queue: PermissionWaiter<Pending>[] = [
    { pending: { askId: "ask-1", toolCallId: "1", title: "a" }, resolve: (id) => resolved.push(id) },
  ];
  settleAllPermissions(queue);
  assert.deepEqual(resolved, [null]);
  // Stale UI click after cancel must not invent a waiter.
  assert.equal(settlePermissionHeadIfAsk(queue, "ask-1", "allow-once"), false);
  assert.deepEqual(resolved, [null]);
});

test("settlePermissionHeadIfAsk accepts deny (null) only for the matching askId", () => {
  const resolved: Array<string | null> = [];
  const queue: PermissionWaiter<Pending>[] = [
    { pending: { askId: "ask-a", toolCallId: "1", title: "a" }, resolve: (id) => resolved.push(id) },
    { pending: { askId: "ask-b", toolCallId: "2", title: "b" }, resolve: (id) => resolved.push(id) },
  ];
  assert.equal(settlePermissionHeadIfAsk(queue, "ask-b", null), false);
  assert.equal(settlePermissionHeadIfAsk(queue, "ask-a", null), true);
  assert.deepEqual(resolved, [null]);
  assert.equal(queue[0]?.pending.askId, "ask-b");
});

test("FIFO view stays consistent across askId-gated settles", () => {
  const queue: PermissionWaiter<Pending>[] = [
    { pending: { askId: "a1", toolCallId: "1", title: "a" }, resolve() {} },
    { pending: { askId: "a2", toolCallId: "2", title: "b" }, resolve() {} },
  ];
  assert.deepEqual(pendingPermissionView(queue), { pending: { askId: "a1", toolCallId: "1", title: "a" }, queued: 1 });
  assert.equal(settlePermissionHeadIfAsk(queue, "a1", "allow-once"), true);
  assert.deepEqual(pendingPermissionView(queue), { pending: { askId: "a2", toolCallId: "2", title: "b" } });
});
