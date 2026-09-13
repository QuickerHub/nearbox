import { hasParentRunId, isRunActive } from "../shared/conversation.ts";
import type { AgentRun } from "@shared/protocol";

// Pure: which queued run may start next. Kept free of Node imports so it can
// be unit-tested under plain `node --test`.

/** Runs that another run is waiting on (its `nearbox ask` has not returned yet). */
function waitingParents(runs: readonly AgentRun[]): Set<string> {
  const waiting = new Set<string>();
  for (const run of runs) {
    if (hasParentRunId(run) && isRunActive(run)) {
      waiting.add(run.parentRunId!);
    }
  }
  return waiting;
}

function isAncestor(byId: ReadonlyMap<string, AgentRun>, ancestorId: string, run: AgentRun): boolean {
  const seen = new Set<string>();
  let current = run.parentRunId;
  while (current && !seen.has(current)) {
    if (current === ancestorId) {
      return true;
    }
    seen.add(current);
    current = byId.get(current)?.parentRunId;
  }
  return false;
}

/**
 * One run per project at a time and at most `limit` overall — except that a
 * run blocked inside `nearbox ask` is idle: it holds no slot, and its project
 * stays open for the sub-runs it is waiting on (and only for those, so a
 * follow-up the user queued behind it still waits its turn).
 */
export function nextRunnable(runs: readonly AgentRun[], limit: number): AgentRun | undefined {
  const waiting = waitingParents(runs);
  const running: AgentRun[] = [];
  let occupying = 0;
  for (const run of runs) {
    if (run.status !== "running") {
      continue;
    }
    running.push(run);
    if (!waiting.has(run.id)) {
      occupying += 1;
    }
  }
  if (occupying >= Math.max(1, limit || 1)) {
    return undefined;
  }
  const byId = new Map(runs.map((run) => [run.id, run] as const));
  return runs.find((run) => {
    if (run.status !== "queued") {
      return false;
    }
    return running.every((other) => other.projectId !== run.projectId || (waiting.has(other.id) && isAncestor(byId, other.id, run)));
  });
}

/** Active runs started (directly or through further delegation) by `runId`. */
export function activeDescendants(runs: readonly AgentRun[], runId: string): AgentRun[] {
  const byId = new Map(runs.map((run) => [run.id, run] as const));
  // Never treat a run as its own descendant (cyclic parentRunId chains).
  return runs.filter((run) => run.id !== runId && isRunActive(run) && hasParentRunId(run) && isAncestor(byId, runId, run));
}
