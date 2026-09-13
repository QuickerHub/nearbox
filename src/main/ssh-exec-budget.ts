/**
 * Pure SSH helper-output budget. Kept free of `@shared` / spawn so
 * `node --test` can pin the flood cap without loading ssh.ts.
 */

/** Probe / list / upload helpers return small payloads; a hostile peer must not fill the hub heap. */
export const MAX_SSH_EXEC_BYTES = 8 * 1024 * 1024;

/** True when adding `incoming` bytes would push accumulated helper output past the cap. */
export function exceedsSshExecBudget(used: number, incoming: number, max = MAX_SSH_EXEC_BYTES): boolean {
  return used + incoming > max;
}
