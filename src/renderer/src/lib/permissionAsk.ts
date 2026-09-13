/**
 * PermissionAsk click busy-state helper. Keep buttons disabled while the
 * resolve request is in flight; clear busy only on failure so the user can
 * retry. Success leaves busy until askId swaps / the ask unmounts.
 */

export function trackPermissionResolve(
  setBusy: (busy: boolean) => void,
  resolve: () => void | PromiseLike<void>,
): void {
  setBusy(true);
  void Promise.resolve()
    .then(() => resolve())
    .catch(() => {
      setBusy(false);
    });
}
