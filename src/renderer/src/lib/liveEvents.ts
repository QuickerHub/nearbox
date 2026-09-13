/**
 * Pure catch-up / live-batch helpers for `useRunEvents`. Keeps seq dedupe and
 * history+buffer merge free of React so `node --test` can pin the race edges.
 */

export type Sequenced = { seq: number };

/**
 * Merge HTTP history with WS events that arrived before catch-up finished.
 * Buffered duplicates are dropped; missing seqs that only arrived on the
 * socket are filled in. The result is always sorted by seq.
 */
export function mergeCatchUpHistory<T extends Sequenced>(
  history: readonly T[],
  buffered: readonly T[],
): { events: T[]; lastSeq: number } {
  // Merge by seq so a WS event that fills a hole in HTTP history is kept (not
  // dropped just because its seq is below the history tip).
  if (!buffered.length) {
    const lastSeq = history[history.length - 1]?.seq ?? 0;
    return { events: [...history], lastSeq };
  }
  const bySeq = new Map<number, T>();
  for (const event of history) {
    bySeq.set(event.seq, event);
  }
  for (const event of buffered) {
    if (!bySeq.has(event.seq)) {
      bySeq.set(event.seq, event);
    }
  }
  const events = [...bySeq.values()];
  if (events.length > 1) {
    events.sort((a, b) => a.seq - b.seq);
  }
  return {
    events,
    lastSeq: events[events.length - 1]?.seq ?? 0,
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

/**
 * Drain the live batch for a UI flush: sort by seq (WS can interleave with
 * catch-up edges), clear `batch`, and return the tip seq for the next filter.
 */
export function drainLiveBatch<T extends Sequenced>(batch: T[]): { events: T[]; lastSeq: number } {
  if (!batch.length) {
    return { events: [], lastSeq: 0 };
  }
  if (batch.length > 1) {
    batch.sort((a, b) => a.seq - b.seq);
  }
  const events = batch.splice(0, batch.length);
  return { events, lastSeq: events[events.length - 1]!.seq };
}
