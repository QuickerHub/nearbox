/**
 * Electron-free warm-host cancel timeline. Mirrors Runner.cancel's warm branch:
 * soft session/cancel, then escalate against a thin host surface so fake-host
 * smoke tests can pin ordering without spawning ACP.
 */

import { CANCEL_GRACE_MS, FORCE_CANCEL_GRACE_MS, warmCancelAfterSoftGrace } from "./cancel-escalation.ts";

/** Host methods the warm-cancel timeline touches. */
export type WarmCancelHostSurface = {
  cancel(sessionId: string): void;
  forceCancel(sessionId: string): void;
  abandonPrompt(sessionId: string): void;
  kill(): void;
};

/** Schedule a one-shot timer (tests inject a fake; runner uses setTimeout). */
export type WarmCancelSchedule = (ms: number, fn: () => void) => void;

export type WarmCancelHostHooks = {
  /** Soft-cancel phase: clear permission asks before notifying the host. */
  settlePermissions(): void;
  /** False once the run left `active` (prompt finished or abandoned). */
  isStillActive(): boolean;
  /**
   * Re-checked when soft grace fires: another warm turn may have joined the
   * same host during the wait; never kill a newly-shared process.
   */
  isSharedHost(): boolean;
  /** Shared host: local abandon finished the turn; keep the process. */
  onAbandonKeepHost(): void;
  /** Sole-user: about to $/cancel_request after soft grace (status logging). */
  onForceCancel?(): void;
};

/**
 * Soft-cancel a warm turn, then escalate after grace.
 * Shared vs sole-user is decided when soft grace fires (not at Stop click).
 * Timers no-op when `isStillActive` is false.
 */
export function startWarmCancelOnHost(
  host: WarmCancelHostSurface,
  sessionId: string,
  schedule: WarmCancelSchedule,
  hooks: WarmCancelHostHooks,
): void {
  hooks.settlePermissions();
  host.cancel(sessionId);

  schedule(CANCEL_GRACE_MS, () => {
    if (!hooks.isStillActive()) {
      return;
    }
    const next = warmCancelAfterSoftGrace(hooks.isSharedHost());
    if (next.action === "abandon-keep-host") {
      host.abandonPrompt(sessionId);
      hooks.onAbandonKeepHost();
      return;
    }
    hooks.onForceCancel?.();
    host.forceCancel(sessionId);
    schedule(FORCE_CANCEL_GRACE_MS, () => {
      if (!hooks.isStillActive()) {
        return;
      }
      // Local reject finishes the turn even if the agent ignored $/cancel_request.
      host.abandonPrompt(sessionId);
      host.kill();
    });
  });
}
