/** Backoff after a failed flush so a disk blip retries without a tight spin. */
export const FLUSH_RETRY_MIN_MS = 500;
export const FLUSH_RETRY_MAX_MS = 10_000;

export function nextFlushRetryDelay(previousMs: number): number {
  const base = previousMs > 0 ? previousMs : FLUSH_RETRY_MIN_MS;
  return Math.min(Math.max(base, FLUSH_RETRY_MIN_MS) * 2, FLUSH_RETRY_MAX_MS);
}
