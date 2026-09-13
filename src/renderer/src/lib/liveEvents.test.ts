import assert from "node:assert/strict";
import test from "node:test";
import { drainLiveBatch, mergeCatchUpHistory, queueLiveEvent } from "./liveEvents.ts";

test("mergeCatchUpHistory appends only buffered seqs after history", () => {
  const history = [{ seq: 1 }, { seq: 2 }];
  const buffered = [{ seq: 2 }, { seq: 3 }, { seq: 4 }];
  const caught = mergeCatchUpHistory(history, buffered);
  assert.deepEqual(
    caught.events.map((event) => event.seq),
    [1, 2, 3, 4],
  );
  assert.equal(caught.lastSeq, 4);
});

test("mergeCatchUpHistory with empty history uses buffered tail", () => {
  const caught = mergeCatchUpHistory<{ seq: number }>([], [{ seq: 5 }, { seq: 6 }]);
  assert.deepEqual(
    caught.events.map((event) => event.seq),
    [5, 6],
  );
  assert.equal(caught.lastSeq, 6);
});

test("queueLiveEvent drops stale and in-batch duplicate seqs", () => {
  const batch: Array<{ seq: number }> = [];
  assert.equal(queueLiveEvent(batch, { seq: 1 }, 0), true);
  assert.equal(queueLiveEvent(batch, { seq: 1 }, 0), false);
  assert.equal(queueLiveEvent(batch, { seq: 0 }, 0), false);
  assert.equal(queueLiveEvent(batch, { seq: 2 }, 0), true);
  assert.deepEqual(
    batch.map((event) => event.seq),
    [1, 2],
  );
});

test("mergeCatchUpHistory drops duplicate buffered seqs and sorts extras", () => {
  const history = [{ seq: 1 }, { seq: 2 }];
  const buffered = [{ seq: 2 }, { seq: 4 }, { seq: 3 }, { seq: 4 }];
  const caught = mergeCatchUpHistory(history, buffered);
  assert.deepEqual(
    caught.events.map((event) => event.seq),
    [1, 2, 3, 4],
  );
  assert.equal(caught.lastSeq, 4);
});

test("mergeCatchUpHistory dedupes within an empty-history buffer", () => {
  const caught = mergeCatchUpHistory<{ seq: number }>([], [{ seq: 5 }, { seq: 5 }, { seq: 6 }]);
  assert.deepEqual(
    caught.events.map((event) => event.seq),
    [5, 6],
  );
  assert.equal(caught.lastSeq, 6);
});


test("drainLiveBatch sorts by seq and clears the batch", () => {
  const batch = [{ seq: 4 }, { seq: 2 }, { seq: 3 }];
  const drained = drainLiveBatch(batch);
  assert.deepEqual(
    drained.events.map((event) => event.seq),
    [2, 3, 4],
  );
  assert.equal(drained.lastSeq, 4);
  assert.equal(batch.length, 0);
});

test("mergeCatchUpHistory with empty history is the HTTP-failure promote path", () => {
  // useRunEvents.catch calls mergeCatchUpHistory([], buffered) so WS events
  // already received are not dropped when /events fails.
  const buffered = [{ seq: 3 }, { seq: 1 }, { seq: 2 }, { seq: 2 }];
  const caught = mergeCatchUpHistory<{ seq: number }>([], buffered);
  assert.deepEqual(
    caught.events.map((event) => event.seq),
    [1, 2, 3],
  );
  assert.equal(caught.lastSeq, 3);
});

test("mergeCatchUpHistory empty inputs yield lastSeq 0", () => {
  const caught = mergeCatchUpHistory<{ seq: number }>([], []);
  assert.deepEqual(caught.events, []);
  assert.equal(caught.lastSeq, 0);
});

test("mergeCatchUpHistory drops buffered seqs already covered by history tip", () => {
  // History tip is 5; a late WS replay of 4/5 must not reappear after catch-up.
  const history = [{ seq: 3 }, { seq: 5 }];
  const buffered = [{ seq: 4 }, { seq: 5 }, { seq: 6 }];
  const caught = mergeCatchUpHistory(history, buffered);
  assert.deepEqual(
    caught.events.map((event) => event.seq),
    [3, 5, 6],
  );
  assert.equal(caught.lastSeq, 6);
});

test("live pipeline: queue then drain advances lastSeq for the next filter", () => {
  const batch: Array<{ seq: number }> = [];
  assert.equal(queueLiveEvent(batch, { seq: 10 }, 9), true);
  assert.equal(queueLiveEvent(batch, { seq: 12 }, 9), true);
  assert.equal(queueLiveEvent(batch, { seq: 11 }, 9), true);
  const drained = drainLiveBatch(batch);
  assert.deepEqual(
    drained.events.map((event) => event.seq),
    [10, 11, 12],
  );
  assert.equal(drained.lastSeq, 12);
  assert.equal(queueLiveEvent(batch, { seq: 12 }, drained.lastSeq), false);
  assert.equal(queueLiveEvent(batch, { seq: 13 }, drained.lastSeq), true);
});

test("drainLiveBatch on empty batch returns lastSeq 0", () => {
  assert.deepEqual(drainLiveBatch<{ seq: number }>([]), { events: [], lastSeq: 0 });
});
