/**
 * Load-time caps so a hand-edited or hostile state.json cannot OOM the host
 * or flood the model picker. Kept free of Node so unit tests stay cheap.
 */

/** Refuse to JSON.parse a state file larger than this (bytes on disk). */
export const MAX_STATE_JSON_BYTES = 32 * 1024 * 1024;

/** Keep at most this many models per agent catalog after reload. */
export const MAX_CATALOG_MODELS = 500;

/** Truncate a model list for persistence/load; preserves order. */
export function capCatalogModels<T>(models: T[], max = MAX_CATALOG_MODELS): T[] {
  return models.length > max ? models.slice(0, max) : models;
}

/** True when on-disk size must not be JSON.parse'd into memory. */
export function isStateJsonTooLarge(byteLength: number): boolean {
  return !Number.isFinite(byteLength) || byteLength < 0 || byteLength > MAX_STATE_JSON_BYTES;
}
