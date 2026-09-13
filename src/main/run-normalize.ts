/**
 * Pure load-time cleanup for persisted AgentRun rows. Kept free of Node so
 * odd JSON (null/"" parentRunId) can be unit-tested under plain node --test.
 */

export type ParentRunFields = { parentRunId?: string | null };

/**
 * Drop null/empty `parentRunId` so Boolean(parentRunId) / hasParentRunId stay
 * aligned with "no parent" after a reload. Real ids are left untouched.
 */
export function stripEmptyParentRunId<T extends ParentRunFields>(run: T): T {
  if (run.parentRunId) {
    return run;
  }
  if (run.parentRunId === undefined) {
    return run;
  }
  const { parentRunId: _drop, ...rest } = run;
  return rest as T;
}

export type PermissionStateFields = {
  pendingPermission?: unknown;
  pendingPermissionQueued?: number;
};

/**
 * Drop live permission UI fields on disk load. A crash mid-ask leaves them on
 * the JSON row; the ask can never be answered after restart, and a leftover
 * `pendingPermissionQueued` without `pendingPermission` is especially confusing.
 */
export function stripTransientPermissionState<T extends PermissionStateFields>(
  run: T,
): Omit<T, "pendingPermission" | "pendingPermissionQueued"> {
  const { pendingPermission: _pending, pendingPermissionQueued: _queued, ...rest } = run;
  return rest;
}

/**
 * `eventCount ?? 0` leaves NaN/Infinity intact (nullish only). Persist a
 * non-negative integer so UI math and JSON never carry poisoned counts.
 */
export function coerceEventCount(value: unknown): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    return 0;
  }
  return Math.min(Math.floor(num), 1_000_000_000);
}

