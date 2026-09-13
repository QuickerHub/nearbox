/**
 * PermissionAsk click busy-state helper. Keep buttons disabled while the
 * resolve request is in flight; clear busy only on failure so the user can
 * retry. Success leaves busy until askId swaps / the ask unmounts.
 *
 * `stillCurrent` ignores a late failure after askId has already moved on, so a
 * stale reject cannot unlock the next ask mid-click.
 */

export function trackPermissionResolve(
  setBusy: (busy: boolean) => void,
  resolve: () => void | PromiseLike<void>,
  stillCurrent?: () => boolean,
): void {
  setBusy(true);
  void Promise.resolve()
    .then(() => resolve())
    .catch(() => {
      if (!stillCurrent || stillCurrent()) {
        setBusy(false);
      }
    });
}
