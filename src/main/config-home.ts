import { isAbsolute } from "node:path";

/**
 * Env config roots must be absolute. Blank values and relative paths like
 * `LOCALAPPDATA=.\evil` would otherwise make agent / Cursor paths resolve
 * relative to the process cwd.
 */
export function resolveConfigHome(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed || !isAbsolute(trimmed)) {
    return fallback;
  }
  return trimmed;
}
