/**
 * Load-time run status hygiene. Unknown / non-string statuses must not survive
 * into the UI as `RUNNING` / `null` rows that break filters and tray counts.
 */

import type { RunStatus } from "@shared/protocol";

const VALID: ReadonlySet<string> = new Set(["queued", "running", "succeeded", "failed", "cancelled"]);

export function isValidRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && VALID.has(value);
}

/**
 * Keep known statuses; anything else becomes `failed` so crash-recovery and
 * tray tallies only see the closed set.
 */
export function coerceRunStatus(value: unknown): RunStatus {
  return isValidRunStatus(value) ? value : "failed";
}
