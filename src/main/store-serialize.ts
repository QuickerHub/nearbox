/**
 * Pure helpers for state.json encoding / temp paths. Kept free of `@shared` so
 * node --test can cover the stringify-throw dirty path without the protocol graph.
 */

/** JSON snapshot for state.json — pure so tests can cover the throw path. */
export function serializeState(state: unknown): string {
  return JSON.stringify(state, null, 2);
}

/** Unique tmp next to state.json so a stuck `.tmp` from a crashed write cannot collide. */
export function stateTempPath(file: string, now = Date.now, pid = process.pid): string {
  return `${file}.${pid}-${now()}.tmp`;
}
