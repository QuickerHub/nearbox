/**
 * Run `write` after any prior attempt, including a rejected one.
 * A plain `previous.then(write)` never runs `write` once `previous` rejects,
 * which would permanently stop a serialized disk queue after one failure.
 */
export function enqueueWrite(previous: Promise<void>, write: () => Promise<void>): Promise<void> {
  return previous.catch(() => undefined).then(write);
}
