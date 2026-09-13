/**
 * Warm-host cancel timing and escalation. Soft cancel first; if ignored,
 * force via $/cancel_request; shared hosts abandon locally without kill.
 */

/** Soft cancel first; if the turn ignores it, escalate. */
export const CANCEL_GRACE_MS = 10_000;
/** Extra wait after $/cancel_request before taking the host process down. */
export const FORCE_CANCEL_GRACE_MS = 3_000;

export type WarmCancelAfterSoft =
  | { action: "abandon-keep-host" }
  | { action: "force-then-kill" };

/** After soft-cancel grace: keep a shared host up; sole-user may force then kill. */
export function warmCancelAfterSoftGrace(sharedHost: boolean): WarmCancelAfterSoft {
  return sharedHost ? { action: "abandon-keep-host" } : { action: "force-then-kill" };
}

/**
 * Mark a run as cancelling. Returns false when a cancel is already in flight
 * so warm grace timers / kill paths are not stacked by a second Stop click.
 */
export function markCancelling(state: { cancelled: boolean }): boolean {
  if (state.cancelled) {
    return false;
  }
  state.cancelled = true;
  return true;
}

/** Timeline status when Stop hits a turn that already has a process / ssh client. */
export function cancelStoppingProcessStatus(reason: string): string {
  return `${reason}，正在停止进程…`;
}

/**
 * Timeline status when Stop hits before spawn / warm attach — nothing to kill
 * yet; startup code finishes on the next `cancelled` check.
 */
export function cancelStartingStatus(reason: string): string {
  return `${reason}，正在取消…`;
}

/**
 * Session id to `session/close` when Stop wins during warm startup before the
 * turn is attached. Only brand-new sessions — a resumed conversation should
 * stay loaded for a later reply.
 */
export function warmStartupSessionToClose(
  sessionId: string | undefined,
  resumed: boolean,
): string | undefined {
  if (!sessionId || resumed) {
    return undefined;
  }
  return sessionId;
}
