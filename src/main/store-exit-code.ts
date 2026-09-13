/**
 * Persist only finite integer exit codes. NaN/Infinity/floats from odd JSON
 * would otherwise poison UI math and comparisons (`exitCode === 0`).
 */
export function coerceExitCode(value: unknown): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value)) {
    return value;
  }
  return undefined;
}
