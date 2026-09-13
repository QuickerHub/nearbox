/**
 * Catalog trim leftovers after id-only whitespace fixes: labels and checkedAt
 * can still carry padding / multi-megabyte strings, and an uncapped models[]
 * stalls the picker even when ids are clean.
 */

export const MAX_CATALOG_MODELS = 500;
export const MAX_CATALOG_STRING = 256;

/** Trim and bound a catalog string; empty after trim becomes undefined. */
export function trimCatalogString(value: unknown, max = MAX_CATALOG_STRING): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().slice(0, max);
  return trimmed || undefined;
}

/** Preserve order; drop the excess tail. */
export function capCatalogModels<T>(models: T[], max = MAX_CATALOG_MODELS): T[] {
  if (!Array.isArray(models)) {
    return [];
  }
  if (!Number.isFinite(max) || max <= 0) {
    return [];
  }
  return models.length > max ? models.slice(0, max) : models;
}
