/**
 * Pure catch-up / live-batch helpers for `useRunEvents`. Keeps seq dedupe and
 * history+buffer merge free of React so `node --test` can pin the race edges.
 */

export type Sequenced = { seq: number };

/** Merge HTTP history with WS events that arrived before catch-up finished. */
export function mergeCatchUpHistory<T extends Sequenced>(
  history: readonly T[],
  buffered: readonly T[],
): { events: T[]; lastSeq: number } {
  const lastFromHistory = history[history.length - 1]?.seq ?? 0;
  const merged = [...history, ...buffered.filter((event) => event.seq > lastFromHistory)];
  return {
    events: merged,
    lastSeq: merged[merged.length - 1]?.seq ?? lastFromHistory,
  };
}

/**
 * Queue one live event for the next flush. Returns false when the seq is stale
 * or already sitting in the current batch (duplicate while a timer is pending).
 */
export function queueLiveEvent<T extends Sequenced>(batch: T[], event: T, lastSeq: number): boolean {
  if (event.seq <= lastSeq) {
    return false;
  }
  if (batch.some((item) => item.seq === event.seq)) {
    return false;
  }
  batch.push(event);
  return true;
}
