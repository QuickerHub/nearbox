/**
 * Electron-free cancel × permission orchestration. The runner settles every
 * queued ask before soft-cancel, then follows warmCancelAfterSoftGrace.
 * These helpers pin that ordering for `node --test`.
 */

import {
  CANCEL_GRACE_MS,
  FORCE_CANCEL_GRACE_MS,
  warmCancelAfterSoftGrace,
  type WarmCancelAfterSoft,
} from "./cancel-escalation.ts";
import {
  settleAllPermissions,
  type PermissionWaiter,
} from "./permission-queue.ts";

export type WarmCancelPhase =
  | { phase: "soft-cancel"; settlePermissions: true }
  | { phase: "after-soft-grace"; waitMs: number; next: WarmCancelAfterSoft }
  | { phase: "after-force-grace"; waitMs: number; action: "abandon-and-kill" };

/**
 * Timeline after the user hits Stop on a warm turn. Permissions are always
 * settled in the soft-cancel phase so a hung ask cannot outlive the run.
 */
export function warmCancelPhases(sharedHost: boolean): WarmCancelPhase[] {
  const next = warmCancelAfterSoftGrace(sharedHost);
  const phases: WarmCancelPhase[] = [
    { phase: "soft-cancel", settlePermissions: true },
    { phase: "after-soft-grace", waitMs: CANCEL_GRACE_MS, next },
  ];
  if (next.action === "force-then-kill") {
    phases.push({ phase: "after-force-grace", waitMs: FORCE_CANCEL_GRACE_MS, action: "abandon-and-kill" });
  }
  return phases;
}

/**
 * Apply the soft-cancel permission side-effect: every waiter resolves null and
 * the queue is empty. Returns how many asks were cancelled.
 */
export function settlePermissionsOnCancel<TPending>(queue: PermissionWaiter<TPending>[]): number {
  const count = queue.length;
  settleAllPermissions(queue);
  return count;
}
