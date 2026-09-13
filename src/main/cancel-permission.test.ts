import assert from "node:assert/strict";
import test from "node:test";
import { CANCEL_GRACE_MS, FORCE_CANCEL_GRACE_MS } from "./cancel-escalation.ts";
import { settlePermissionsOnCancel, warmCancelPhases } from "./cancel-permission.ts";
import {
  pendingPermissionView,
  settlePermissionHead,
  type PermissionWaiter,
} from "./permission-queue.ts";

type Pending = { toolCallId: string; title: string };

test("warmCancelPhases: shared host abandons without force-kill", () => {
  const phases = warmCancelPhases(true);
  assert.deepEqual(phases, [
    { phase: "soft-cancel", settlePermissions: true },
    { phase: "after-soft-grace", waitMs: CANCEL_GRACE_MS, next: { action: "abandon-keep-host" } },
  ]);
});

test("warmCancelPhases: sole-user forces then abandon-and-kill", () => {
  const phases = warmCancelPhases(false);
  assert.deepEqual(phases, [
    { phase: "soft-cancel", settlePermissions: true },
    { phase: "after-soft-grace", waitMs: CANCEL_GRACE_MS, next: { action: "force-then-kill" } },
    { phase: "after-force-grace", waitMs: FORCE_CANCEL_GRACE_MS, action: "abandon-and-kill" },
  ]);
  assert.ok(CANCEL_GRACE_MS > FORCE_CANCEL_GRACE_MS);
});

test("cancel settles every permission ask before soft-cancel timeline continues", () => {
  const resolved: Array<string | null> = [];
  const queue: PermissionWaiter<Pending>[] = [
    { pending: { toolCallId: "1", title: "a" }, resolve: (id) => resolved.push(id) },
    { pending: { toolCallId: "2", title: "b" }, resolve: (id) => resolved.push(id) },
    { pending: { toolCallId: "3", title: "c" }, resolve: (id) => resolved.push(id) },
  ];
  // User allowed the head; two remain queued when they hit Stop.
  settlePermissionHead(queue, "allow-once");
  assert.deepEqual(resolved, ["allow-once"]);
  assert.deepEqual(pendingPermissionView(queue), { pending: { toolCallId: "2", title: "b" }, queued: 1 });

  const soft = warmCancelPhases(false)[0]!;
  assert.equal(soft.phase, "soft-cancel");
  assert.equal(soft.settlePermissions, true);
  const cancelled = settlePermissionsOnCancel(queue);
  assert.equal(cancelled, 2);
  assert.deepEqual(resolved, ["allow-once", null, null]);
  assert.equal(queue.length, 0);
  assert.deepEqual(pendingPermissionView(queue), {});
});
