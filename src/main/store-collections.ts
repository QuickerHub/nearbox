/**
 * Load-time caps on persisted collections. A hostile state.json under the
 * byte-size ceiling can still pack hundreds of thousands of tiny rows and
 * stall startup while normalize runs — keep lists bounded.
 */

export const MAX_TASKS = 2_000;
export const MAX_PROJECTS = 500;
export const MAX_SESSIONS = 200;
export const MAX_REMOTE_DEVICES = 200;
export const MAX_FILES = 2_000;
/** Keep checkedAt / model ids from becoming multi-megabyte strings. */
export const MAX_CATALOG_STRING = 256;

/** Preserve the most-recent tail (same idea as MAX_RUNS_KEPT on flush). */
export function capArrayTail<T>(items: T[], max: number): T[] {
  if (!Number.isFinite(max) || max <= 0) {
    return [];
  }
  return items.length > max ? items.slice(-max) : items;
}

/** Drop excess object keys (arbitrary map order is fine for files). */
export function capRecordKeys<T>(record: Record<string, T>, max: number): Record<string, T> {
  if (!Number.isFinite(max) || max <= 0) {
    return {};
  }
  const keys = Object.keys(record);
  if (keys.length <= max) {
    return record;
  }
  const out: Record<string, T> = {};
  for (const key of keys.slice(0, max)) {
    out[key] = record[key]!;
  }
  return out;
}

/** Trim and bound a catalog string; empty after trim becomes undefined. */
export function capCatalogString(value: unknown, max = MAX_CATALOG_STRING): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().slice(0, max);
  return trimmed || undefined;
}
