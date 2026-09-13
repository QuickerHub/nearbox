/**
 * Load-time task priority hygiene. Hub writes only "high" | "normal"; odd JSON
 * must not leave other strings on the row.
 */

export type TaskPriority = "normal" | "high";

/** Same rule as Hub.createTask / updateTask: only "high" sticks. */
export function coerceTaskPriority(value: unknown): TaskPriority {
  return value === "high" ? "high" : "normal";
}
