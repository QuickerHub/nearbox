import type { AgentRun } from "./protocol";

// Runs chained through `resumedFromRunId` form one agent conversation. These
// helpers are runtime-import free so the renderer can unit-test them under Node.

/** Follow `resumedFromRunId` links from `runId` back to the newest run that recorded a session id. */
export function sessionIdAlongChain(runs: readonly AgentRun[], runId: string | undefined): string | undefined {
  const seen = new Set<string>();
  let current = runId;
  while (current && !seen.has(current)) {
    seen.add(current);
    const run = runs.find((item) => item.id === current);
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

