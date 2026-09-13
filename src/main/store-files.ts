/**
 * Load-time cleanup for the files map. One bad entry must not break uploads or
 * wipe the whole state.json (arrays are typeof "object" in JSON).
 */

export interface StoredFileRow {
  path: string;
  name: string;
  mediaType: string;
  byteLength?: number;
}

/** Keep only well-formed file rows; drop arrays / null / entries missing path+name. */
export function normalizeFilesMap(raw: unknown): Record<string, StoredFileRow> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, StoredFileRow> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!id || !value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const row = value as Record<string, unknown>;
    if (typeof row.path !== "string" || !row.path || typeof row.name !== "string" || !row.name) {
      continue;
    }
    const mediaType =
      typeof row.mediaType === "string" && row.mediaType.trim() ? row.mediaType.trim() : "application/octet-stream";
    const next: StoredFileRow = { path: row.path, name: row.name, mediaType };
    if (typeof row.byteLength === "number" && Number.isFinite(row.byteLength) && row.byteLength >= 0) {
      next.byteLength = row.byteLength;
    }
    out[id] = next;
  }
  return out;
}
