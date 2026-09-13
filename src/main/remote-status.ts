/**
 * Pure RemoteStatus identity helpers. Snapshots call status() on every
 * coalesce tick; reuse the same object when supported/enabled/controllers
 * (and display size) are unchanged so React memos are not busted — and so
 * we can skip Electron screen.getPrimaryDisplay on idle ticks.
 */

export type RemoteDisplayLike = { width: number; height: number };

export type RemoteStatusLike = {
  supported: boolean;
  enabled: boolean;
  controllers: number;
  display: RemoteDisplayLike | null;
};

/** Compact signature of the remote row carried on HostSnapshot.remote. */
export function remoteStatusSignature(status: RemoteStatusLike): string {
  const display = status.display;
  return `${status.supported ? 1 : 0}|${status.enabled ? 1 : 0}|${status.controllers}|${display ? `${display.width}x${display.height}` : ""}`;
}

/**
 * Return `cached` when the signature matches `next`; otherwise `next`.
 * Callers still build `next` when they already paid for display size.
 */
export function reuseRemoteStatus<T extends RemoteStatusLike>(cached: T | null | undefined, next: T): T {
  if (cached && remoteStatusSignature(cached) === remoteStatusSignature(next)) {
    return cached;
  }
  return next;
}

/**
 * When supported/enabled/controllers match the cache, keep it (skip display
 * lookup). Display size almost never changes mid-session.
 */
export function remoteStatusFieldsMatch(
  cached: Pick<RemoteStatusLike, "supported" | "enabled" | "controllers"> | null | undefined,
  supported: boolean,
  enabled: boolean,
  controllers: number,
): boolean {
  return Boolean(
    cached && cached.supported === supported && cached.enabled === enabled && cached.controllers === controllers,
  );
}
