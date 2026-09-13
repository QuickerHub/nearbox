/**
 * Pure catch-up / live-batch helpers for `useRunEvents`. Keeps seq dedupe and
 * history+buffer merge free of React so `node --test` can pin the race edges.
 */

export type Sequenced = { seq: number };

/**
 * Merge HTTP history with WS events that arrived before catch-up finished.
 * Buffered duplicates (same seq twice, or already in history) are dropped;
 * extras are appended in seq order so a reordered buffer cannot scramble the
 * transcript.
 */
export function mergeCatchUpHistory<T extends Sequenced>(
  history: readonly T[],
  buffered: readonly T[],
): { events: T[]; lastSeq: number } {
  const lastFromHistory = history[history.length - 1]?.seq ?? 0;
  const seen = new Set<number>();
  for (const event of history) {
    seen.add(event.seq);
  }
  const extra: T[] = [];
  for (const event of buffered) {
    if (event.seq <= lastFromHistory || seen.has(event.seq)) {
      continue;
    }
    seen.add(event.seq);
    extra.push(event);
  }
  if (extra.length > 1) {
    extra.sort((a, b) => a.seq - b.seq);
  }
  const merged = extra.length ? [...history, ...extra] : [...history];
  return {
    events: merged,
    lastSeq: merged[merged.length - 1]?.seq ?? lastFromHistory,
  };
}


/**
 * Append events fetched after a WS reconnect. Drops seqs already on screen and
 * keeps order so a gap left during the dropout is filled without duplicates.
 */
export function appendCatchUpEvents<T extends Sequenced>(
  current: readonly T[],
  more: readonly T[],
): { events: T[]; lastSeq: number } {
  if (!more.length) {
    return { events: [...current], lastSeq: current[current.length - 1]?.seq ?? 0 };
  }
  const seen = new Set<number>();
  for (const event of current) {
    seen.add(event.seq);
  }
  const extra: T[] = [];
  for (const event of more) {
    if (seen.has(event.seq)) {
      continue;
    }
    seen.add(event.seq);
    extra.push(event);
  }
  if (extra.length > 1) {
    extra.sort((a, b) => a.seq - b.seq);
  }
  const events = extra.length ? [...current, ...extra] : [...current];
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
