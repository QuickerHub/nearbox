/**
 * Long-poll helper for `nearbox wait` / GET /api/runs/:id?wait=.
 * Runtime-import free of the hub so the subscribe/re-check race is unit-tested.
 */

export type WaitRunHooks<T extends { id: string }> = {
  isActive: (run: T) => boolean;
  onFinished: (listener: (finished: T) => void) => void;
  offFinished: (listener: (finished: T) => void) => void;
  maxWaitMs: number;
};

/**
 * Resolves when `run` is no longer active or `timeoutMs` elapses.
 * Subscribes before the second active check so a finish that lands between the
 * first check and `onFinished` cannot be missed (which would hang until timeout).
 */
export function waitForActiveRun<T extends { id: string }>(
  run: T,
  timeoutMs: number,
  hooks: WaitRunHooks<T>,
): Promise<T> {
  const wait = Math.min(hooks.maxWaitMs, Math.max(0, timeoutMs));
  if (!hooks.isActive(run) || wait === 0) {
    return Promise.resolve(run);
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      hooks.offFinished(done);
      resolve(run);
    };
    const done = (finished: T) => {
      if (finished.id === run.id) {
        settle();
      }
    };
    const timer = setTimeout(settle, wait);
    hooks.onFinished(done);
    // Re-check: the run may have finished between the first active test and the listener.
    if (!hooks.isActive(run)) {
      settle();
    }
  });
}
