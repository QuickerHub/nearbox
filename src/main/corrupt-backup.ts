import { renameSync } from "node:fs";

/**
 * Move a broken state.json aside before returning empty state.
 * Sync on purpose: an async rename can race the next flush and rename the
 * freshly written good file to `.corrupt-*`.
 */
export function backupCorruptStateFile(file: string, now = Date.now): string | null {
  const backup = `${file}.corrupt-${now()}`;
  try {
    renameSync(file, backup);
    return backup;
  } catch {
    return null;
  }
}
