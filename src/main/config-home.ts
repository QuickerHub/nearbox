import { isAbsolute } from "node:path";

/**
 * Env config roots must be absolute. Blank values and relative paths like
 * `APPDATA=.\evil` would otherwise make Cursor/cli paths resolve relative to
 * the process cwd (round 5 only fixed blank via trim empties on other PRs).
 */
export function resolveConfigHome(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed || !isAbsolute(trimmed)) {
    return fallback;
  }
  return trimmed;
}
