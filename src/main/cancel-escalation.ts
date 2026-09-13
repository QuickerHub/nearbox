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
