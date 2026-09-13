/**
 * How many recent AgentRun rows a HostSnapshot carries. Full history stays on
 * disk; the phone/UI only needs the tail. Reuse the same array reference when
 * under the limit so React memos are not busted on every coalesce tick.
 */

export const SNAPSHOT_RUN_LIMIT = 120;

/** Last `limit` runs, or the original array when it already fits. */
export function recentRuns<T>(runs: readonly T[], limit = SNAPSHOT_RUN_LIMIT): T[] {
  if (runs.length <= limit) {
    return runs as T[];
  }
  return runs.slice(-limit);
}
