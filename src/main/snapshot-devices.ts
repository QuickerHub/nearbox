/**
 * Snapshot helpers for the paired-device Map. Reuse the values array across
 * coalesce ticks when the Map membership is unchanged (in-place online flips
 * still show up via the same DeviceInfo object references).
 */

export type DeviceLike = { role: string; online?: boolean };

/** Count online phones without allocating a filtered array. */
export function countOnlinePhones(devices: Iterable<DeviceLike>): number {
  let count = 0;
  for (const device of devices) {
    if (device.role === "phone" && device.online) {
      count += 1;
    }
  }
  return count;
}

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
