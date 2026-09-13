/**
 * Stale-check helpers for AppUpdater. A corrupt / future `checkedAt` must not
 * suppress refresh forever (`now - future < STALE_MS` is always true).
 */

/** Refuse to JSON.parse a huge GitHub releases/latest body (OOM / hang). */
export const MAX_RELEASE_JSON_BYTES = 1_048_576;

/**
 * True when a prior successful check is still within the freshness window.
 * Non-finite, non-positive, or future timestamps are treated as stale.
 */
export function isCheckFresh(checkedAtMs: number, nowMs: number, staleMs: number): boolean {
  if (!Number.isFinite(checkedAtMs) || !Number.isFinite(nowMs) || !Number.isFinite(staleMs)) {
    return false;
  }
  if (checkedAtMs <= 0 || staleMs <= 0) {
    return false;
  }
  const age = nowMs - checkedAtMs;
  return age >= 0 && age < staleMs;
}

/** True when Content-Length (or a buffered byte length) exceeds the release JSON ceiling. */
export function isReleaseJsonTooLarge(byteLength: number): boolean {
  return !Number.isFinite(byteLength) || byteLength < 0 || byteLength > MAX_RELEASE_JSON_BYTES;
}
