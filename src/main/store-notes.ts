/**
 * Bound how many notes one task may carry after load. Collection caps (#60)
 * limit task count; a single task can still embed a huge notes[] and stall
 * normalize/UI without this ceiling.
 */

export const MAX_NOTES_PER_TASK = 500;

/** Preserve the newest tail of a notes list. */
export function capNotesTail<T>(notes: T[], max = MAX_NOTES_PER_TASK): T[] {
  if (!Array.isArray(notes)) {
    return [];
  }
  if (!Number.isFinite(max) || max <= 0) {
    return [];
  }
  return notes.length > max ? notes.slice(-max) : notes;
}
