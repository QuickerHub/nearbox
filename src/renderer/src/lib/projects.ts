/** Shared project ordering for chips, settings cards, and default picks. */

export type ProjectRecency = { lastUsedAt?: string; createdAt: string };

/** Milliseconds for lastUsedAt, else createdAt (NaN-safe → 0). */
export function projectRecency(project: ProjectRecency): number {
  const value = Date.parse(project.lastUsedAt ?? project.createdAt);
  return Number.isFinite(value) ? value : 0;
}

/** Newest first (by lastUsedAt / createdAt). */
export function compareProjectsByRecency(a: ProjectRecency, b: ProjectRecency): number {
  return projectRecency(b) - projectRecency(a);
}

/** Single-pass pick of the most recently used project (no sort alloc). */
export function mostRecentProject<T extends ProjectRecency>(projects: readonly T[]): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const project of projects) {
    const score = projectRecency(project);
    if (!best || score > bestScore) {
      best = project;
      bestScore = score;
    }
  }
  return best;
}
