/**
 * PermissionAsk click busy-state helper. Keep buttons disabled while the
 * resolve request is in flight; clear busy only on failure so the user can
 * retry. Success leaves busy until askId swaps / the ask unmounts.
 *
 * Dock and transcript both mount a PermissionAsk for the same askId; a shared
 * in-flight set stops a double Allow/Deny click from racing two resolves.
 * Mount refcounts keep the in-flight mark alive until every surface is gone.
 */

const inFlight = new Set<string>();
const mounts = new Map<string, number>();

export function retainPermissionAsk(askId: string): void {
  mounts.set(askId, (mounts.get(askId) ?? 0) + 1);
}

export function releasePermissionAsk(askId: string): void {
  const next = (mounts.get(askId) ?? 0) - 1;
  if (next <= 0) {
    mounts.delete(askId);
    inFlight.delete(askId);
    return;
  }
  mounts.set(askId, next);
}

export function trackPermissionResolve(
  askId: string,
  setBusy: (busy: boolean) => void,
  resolve: () => void | PromiseLike<void>,
): void {
  if (inFlight.has(askId)) {
    setBusy(true);
    return;
  }
  inFlight.add(askId);
  setBusy(true);
  void Promise.resolve()
    .then(() => resolve())
    .catch(() => {
      inFlight.delete(askId);
      setBusy(false);
    });
}

/** Test helper: empty the in-flight / mount maps between cases. */
export function resetPermissionResolveForTests(): void {
  inFlight.clear();
  mounts.clear();
}
