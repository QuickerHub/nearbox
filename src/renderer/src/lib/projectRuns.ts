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
