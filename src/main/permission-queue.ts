/**
 * Pure FIFO permission-ask queue view/settle helpers. The runner owns the
 * waiters; these functions keep head/`pendingPermissionQueued` consistent and
 * are covered by `node --test` without Electron.
 */

export type PermissionWaiter<TPending> = {
  pending: TPending;
  resolve(optionId: string | null): void;
};

/** What the UI should show for the current head ask (and how many wait behind). */
export function pendingPermissionView<TPending>(
  queue: readonly PermissionWaiter<TPending>[],
): { pending?: TPending; queued?: number } {
  const head = queue[0];
  if (!head) {
    return {};
  }
  const queued = queue.length - 1;
  return queued > 0 ? { pending: head.pending, queued } : { pending: head.pending };
}

/** Resolve the head waiter (or no-op) and return the remainder. */
export function settlePermissionHead<TPending>(
  queue: PermissionWaiter<TPending>[],
  optionId: string | null,
): PermissionWaiter<TPending>[] {
  const waiter = queue.shift();
  waiter?.resolve(optionId);
  return queue;
}

/** Cancel every waiter (run finished or user stopped the turn). */
export function settleAllPermissions<TPending>(queue: PermissionWaiter<TPending>[]): void {
  const waiters = queue.splice(0);
  for (const waiter of waiters) {
    waiter.resolve(null);
  }
}
