/**
 * Load-time task status hygiene. Unknown / non-string statuses must not reach
 * STATUS_LABELS lookups or board filters.
 */

import type { TaskStatus } from "@shared/protocol";

const VALID: ReadonlySet<string> = new Set(["inbox", "todo", "doing", "done"]);

/**
 * Keep known statuses; anything else fails closed to inbox — same shelf as a
 * new capture.
 */
export function coerceTaskStatus(value: unknown): TaskStatus {
  return typeof value === "string" && VALID.has(value) ? (value as TaskStatus) : "inbox";
}
