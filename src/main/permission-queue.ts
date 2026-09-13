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

/**
 * Settle the head only when `askId` matches. Stale clicks that still carry an
 * earlier ask's optionId must not resolve the next FIFO head.
 */
export function settlePermissionHeadIfAsk<TPending extends { askId: string }>(
  queue: PermissionWaiter<TPending>[],
  askId: string,
  optionId: string | null,
): boolean {
  const head = queue[0];
  if (!head || head.pending.askId !== askId) {
    return false;
  }
  queue.shift();
  head.resolve(optionId);
  return true;
}

/** Take every waiter off the queue without resolving (runner syncs UI first). */
export function drainPermissionQueue<TPending>(queue: PermissionWaiter<TPending>[]): PermissionWaiter<TPending>[] {
  return queue.splice(0);
}

/** Cancel every waiter (run finished or user stopped the turn). */
export function settleAllPermissions<TPending>(queue: PermissionWaiter<TPending>[]): void {
  for (const waiter of drainPermissionQueue(queue)) {
    waiter.resolve(null);
  }
}
