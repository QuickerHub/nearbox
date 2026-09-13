/**
 * Load-time run list bound. Flush already trims to MAX_RUNS_KEPT; without the
 * same cap on load, a bloated state.json still maps/normalizes every row first.
 */

export const MAX_RUNS_KEPT = 300;

/** Keep the newest tail (same window flush uses when persisting). */
export function capRunsOnLoad<T>(runs: T[]): T[] {
  if (runs.length <= MAX_RUNS_KEPT) {
    return runs;
  }
  return runs.slice(-MAX_RUNS_KEPT);
}
