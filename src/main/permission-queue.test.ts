import assert from "node:assert/strict";
import test from "node:test";
import { drainPermissionQueue, pendingPermissionView, settleAllPermissions, settlePermissionHead, type PermissionWaiter } from "./permission-queue.ts";

type Pending = { toolCallId: string; title: string };

test("pendingPermissionView exposes head and remaining count", () => {
  assert.deepEqual(pendingPermissionView([]), {});
  const one: PermissionWaiter<Pending>[] = [{ pending: { toolCallId: "1", title: "a" }, resolve() {} }];
  assert.deepEqual(pendingPermissionView(one), { pending: { toolCallId: "1", title: "a" } });
  const two: PermissionWaiter<Pending>[] = [
    { pending: { toolCallId: "1", title: "a" }, resolve() {} },
    { pending: { toolCallId: "2", title: "b" }, resolve() {} },
    { pending: { toolCallId: "3", title: "c" }, resolve() {} },
  ];
  assert.deepEqual(pendingPermissionView(two), { pending: { toolCallId: "1", title: "a" }, queued: 2 });
});

test("settlePermissionHead resolves FIFO and settleAll cancels the rest", () => {
  const resolved: Array<string | null> = [];
  const queue: PermissionWaiter<Pending>[] = [
    { pending: { toolCallId: "1", title: "a" }, resolve: (id) => resolved.push(id) },
    { pending: { toolCallId: "2", title: "b" }, resolve: (id) => resolved.push(id) },
    { pending: { toolCallId: "3", title: "c" }, resolve: (id) => resolved.push(id) },
  ];
  settlePermissionHead(queue, "allow-once");
  assert.deepEqual(resolved, ["allow-once"]);
  assert.equal(queue.length, 2);
  assert.deepEqual(pendingPermissionView(queue), { pending: { toolCallId: "2", title: "b" }, queued: 1 });
  settleAllPermissions(queue);
  assert.deepEqual(resolved, ["allow-once", null, null]);
  assert.equal(queue.length, 0);
  assert.deepEqual(pendingPermissionView(queue), {});
});

test("drainPermissionQueue clears without resolving", () => {
  const resolved: Array<string | null> = [];
  const queue: PermissionWaiter<Pending>[] = [
    { pending: { toolCallId: "1", title: "a" }, resolve: (id) => resolved.push(id) },
    { pending: { toolCallId: "2", title: "b" }, resolve: (id) => resolved.push(id) },
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

