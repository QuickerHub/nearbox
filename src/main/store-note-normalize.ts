/**
 * Load-time hygiene for task notes. Notes-per-task caps live elsewhere; one note
 * can still embed a huge files[] / text blob or a garbage kind. Free of `@shared`
 * so node --test can import this file directly.
 */

/** Same ceiling Hub enforces when attaching files to a live message. */
export const MAX_FILES_PER_NOTE = 8;
/** Same ceiling as share capture text. */
export const MAX_NOTE_TEXT_CHARS = 20_000;

export type NoteKind = "note" | "status" | "run";

export interface NoteFileMeta {
  id: string;
  name: string;
  mediaType: string;
  byteLength: number;
}

export interface NormalizedNote {
  id: string;
  kind: NoteKind;
  from: unknown;
  text?: string;
  files?: NoteFileMeta[];
  runId?: string;
  createdAt: string;
}

const NOTE_KINDS: ReadonlySet<string> = new Set(["note", "status", "run"]);

/** Fail closed: unknown kinds render as ordinary notes. */
export function coerceNoteKind(value: unknown): NoteKind {
  return typeof value === "string" && NOTE_KINDS.has(value) ? (value as NoteKind) : "note";
}

/** Keep only well-formed file rows; cap to the live message file limit. */
export function sanitizeNoteFiles(value: unknown, max = MAX_FILES_PER_NOTE): NoteFileMeta[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out: NoteFileMeta[] = [];
  for (const item of value) {
    if (out.length >= max) {
      break;
    }
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id || typeof row.name !== "string" || !row.name) {
      continue;
    }
    if (typeof row.mediaType !== "string" || !row.mediaType) {
      continue;
    }
    if (typeof row.byteLength !== "number" || !Number.isFinite(row.byteLength) || row.byteLength < 0) {
      continue;
    }
    out.push({
      id: row.id,
      name: row.name,
      mediaType: row.mediaType,
      byteLength: row.byteLength,
    });
  }
  return out.length ? out : undefined;
}

/** Bound note text the same way share limits bound a capture. */
export function capNoteText(value: unknown, max = MAX_NOTE_TEXT_CHARS): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Normalize one note row. Returns null for non-objects / missing id so a single
 * bad notes[] element cannot throw the whole state.json load into emptyState.
 */
export function normalizeNoteRow(note: unknown): NormalizedNote | null {
  if (!note || typeof note !== "object") {
    return null;
  }
  const raw = note as Record<string, unknown>;
  if (typeof raw.id !== "string" || !raw.id) {
    return null;
  }
  const legacy = raw.file ? sanitizeNoteFiles([raw.file]) : undefined;
  const files = sanitizeNoteFiles(raw.files) ?? legacy;
  const text = capNoteText(raw.text);
  const next: NormalizedNote = {
    id: raw.id,
    kind: coerceNoteKind(raw.kind),
    from: raw.from,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
  };
  if (text !== undefined) {
    next.text = text;
  }
  if (files) {
    next.files = files;
  }
  if (typeof raw.runId === "string" && raw.runId) {
    next.runId = raw.runId;
  }
  return next;
}
