/**
 * Pure load helpers for state.json. Kept free of the Store class so node --test
 * can cover "should we persist after normalize?" without Electron.
 */

/** True when JSON root is a plain object (not null/array/primitive). */
export function isPersistedStateRoot(raw: unknown): raw is Record<string, unknown> {
  return Boolean(raw) && typeof raw === "object" && !Array.isArray(raw);
}

export type LoadRunLike = {
  status?: string;
  error?: string;
  finishedAt?: string;
  eventCount?: number;
  parentRunId?: string | null;
  pendingPermission?: unknown;
  pendingPermissionQueued?: number;
};

/**
 * Whether normalizeRun changed something that must be written back. Crash marks
 * running/queued as failed only in memory today; without a follow-up save the
 * disk row stays "running" and finishedAt churns on every restart.
 */
export function runNeedsPersistAfterLoad(before: LoadRunLike, after: LoadRunLike): boolean {
  if (before.status === "running" || before.status === "queued") {
    return true;
  }
  if (before.pendingPermission !== undefined || before.pendingPermissionQueued !== undefined) {
    return true;
  }
  if (before.parentRunId !== undefined && !before.parentRunId) {
    return true;
  }
  if (before.eventCount === undefined && after.eventCount === 0) {
    return true;
  }
  return false;
}
