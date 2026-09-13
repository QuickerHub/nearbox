import type { AgentRun } from "./protocol";

// Runs chained through `resumedFromRunId` form one agent conversation. These
// helpers are runtime-import free so the renderer can unit-test them under Node.

/** Follow `resumedFromRunId` links from `runId` back to the newest run that recorded a session id. */
export function sessionIdAlongChain(runs: readonly AgentRun[], runId: string | undefined): string | undefined {
  if (!runId) {
    return undefined;
  }
  // Map once: composer/plan call this on every tick while chains stay short.
  const byId = new Map(runs.map((run) => [run.id, run] as const));
  const seen = new Set<string>();
  let current: string | undefined = runId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const run = byId.get(current);
    if (!run) {
      return undefined;
    }
    if (run.sessionId) {
      return run.sessionId;
    }
    current = run.resumedFromRunId;
  }
  return undefined;
}

/**
 * A new message can continue this run's conversation when a session already
 * exists somewhere along its chain, or when the run is still going and will
 * produce one.
 */
export function canContinueRun(runs: readonly AgentRun[], run: AgentRun): boolean {
  const active = run.status === "queued" || run.status === "running";
  return active || Boolean(sessionIdAlongChain(runs, run.id));
}

/**
 * True when this run was started via `nearbox ask` (has a real parent id).
 * Treat null/"" like missing — matches plan/taskList `!parentRunId` and survives odd JSON.
 */
export function hasParentRunId(run: Pick<AgentRun, "parentRunId">): boolean {
  return Boolean(run.parentRunId);
}

/** Queued/running turn that blocks the composer; delegated children do not. */
export function isTopLevelActiveRun(run: Pick<AgentRun, "status" | "parentRunId">): boolean {
  return (run.status === "queued" || run.status === "running") && !hasParentRunId(run);
}

/** Count queued+running without allocating a filtered array (document title, badges). */
export function countActiveRuns(runs: readonly Pick<AgentRun, "status">[]): number {
  let count = 0;
  for (const run of runs) {
    if (run.status === "queued" || run.status === "running") {
      count += 1;
    }
  }
  return count;
}

