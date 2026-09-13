/**
 * Pure helpers for warm-host session retention: how many to keep loaded, which
 * unused ones to close, and whether idle kill should session/close first.
 * Free of Node / Electron so `node --test` can pin the policy.
 */

/** Cap on sessions kept resident in one AgentHost; flicking tasks must not unbounded-load. */
export const MAX_LOADED_SESSIONS = 4;

export type SessionTouch = {
  sessionId: string;
  lastUsedAt: number;
};

/**
 * Oldest unused sessions to close so the kept set fits under `max`.
 * Busy sessions and `keepId` are never closed.
 */
export function sessionsToPrune(
  loaded: readonly SessionTouch[],
  options: { keepId?: string; busyIds?: ReadonlySet<string>; max?: number } = {},
): string[] {
  const max = options.max ?? MAX_LOADED_SESSIONS;
  if (loaded.length <= max) {
    return [];
  }
  const protectedIds = new Set<string>(options.busyIds ?? []);
  if (options.keepId) {
    protectedIds.add(options.keepId);
  }
  const closable = loaded
    .filter((session) => !protectedIds.has(session.sessionId))
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const overflow = loaded.length - max;
  return closable.slice(0, Math.max(0, overflow)).map((session) => session.sessionId);
}

/** Idle kill should release ACP sessions first when the agent advertised close. */
export function shouldCloseSessionsBeforeIdleKill(supportsSessionClose: boolean, loadedCount: number): boolean {
  return supportsSessionClose && loadedCount > 0;
}
