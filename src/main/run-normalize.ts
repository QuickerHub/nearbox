/**
 * Pure load-time cleanup for persisted AgentRun rows. Kept free of Node so
 * odd JSON (null/"" parentRunId) can be unit-tested under plain node --test.
 */

export type ParentRunFields = { parentRunId?: string | null };

/**
 * Drop null/empty/whitespace `parentRunId` so Boolean(parentRunId) / hasParentRunId
 * stay aligned with "no parent" after a reload. Real ids are trimmed and kept.
 */
export function stripEmptyParentRunId<T extends ParentRunFields>(run: T): T {
  const raw = run.parentRunId;
  if (raw === undefined) {
    return run;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) {
      if (trimmed === raw) {
        return run;
      }
      return { ...run, parentRunId: trimmed };
    }
  }
  // null, non-string, or whitespace-only → treat as missing
  const { parentRunId: _drop, ...rest } = run;
  return rest as T;
}

export type ResumedFromFields = { resumedFromRunId?: string | null };

/**
 * Drop null/empty/whitespace `resumedFromRunId`. A blank resume link would make
 * sessionIdAlongChain walk a useless key; whitespace-only ids are truthy and
 * used to look especially confusing after a crash-reload.
 */
export function stripEmptyResumedFromRunId<T extends ResumedFromFields>(run: T): T {
  const raw = run.resumedFromRunId;
  if (raw === undefined) {
    return run;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) {
      if (trimmed === raw) {
        return run;
      }
      return { ...run, resumedFromRunId: trimmed };
    }
  }
  const { resumedFromRunId: _drop, ...rest } = run;
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
