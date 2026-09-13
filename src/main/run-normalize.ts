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
