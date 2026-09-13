/**
 * Snapshot helpers for the paired-device Map. Reuse the values array across
 * coalesce ticks when the Map membership is unchanged (in-place online flips
 * still show up via the same DeviceInfo object references).
 *
 * Phone counting lives in shared/devices so the renderer header can use it too.
 */

export { countOnlinePhones, type DeviceLike } from "../shared/devices.ts";

/**
 * Return `cached` when `revision` matches; otherwise build a fresh values array.
 * Callers bump `revision` on Map set/delete (not on in-place field edits).
 */
export function reuseMapValues<T>(
  revision: number,
  cached: { revision: number; values: T[] } | null | undefined,
  values: () => T[],
): { revision: number; values: T[] } {
  if (cached && cached.revision === revision) {
    return cached;
  }
  return { revision, values: values() };
}
