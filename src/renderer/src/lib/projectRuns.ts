/** Active + total runs for one project in a single pass (settings project cards). */
export function countProjectRuns(
  runs: readonly { projectId: string; status: string }[],
  projectId: string,
): { active: number; total: number } {
  let active = 0;
  let total = 0;
  for (const run of runs) {
    if (run.projectId !== projectId) {
      continue;
    }
    total += 1;
    if (run.status === "queued" || run.status === "running") {
      active += 1;
    }
  }
  return { active, total };
}

export type ProjectRunCount = { active: number; total: number };

const EMPTY_COUNT: ProjectRunCount = { active: 0, total: 0 };

/** Active + total runs for every project in one walk (settings project cards). */
export function countAllProjectRuns(
  runs: readonly { projectId: string; status: string }[],
): Map<string, ProjectRunCount> {
  const map = new Map<string, ProjectRunCount>();
  for (const run of runs) {
    let entry = map.get(run.projectId);
    if (!entry) {
      entry = { active: 0, total: 0 };
      map.set(run.projectId, entry);
    }
    entry.total += 1;
    if (run.status === "queued" || run.status === "running") {
      entry.active += 1;
    }
  }
  return map;
}

/** Look up one project's counts; missing projects are zeros. */
export function projectRunCount(counts: ReadonlyMap<string, ProjectRunCount>, projectId: string): ProjectRunCount {
  return counts.get(projectId) ?? EMPTY_COUNT;
}
