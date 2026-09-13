import assert from "node:assert/strict";
import test from "node:test";
import { mergeCatchUpHistory, queueLiveEvent } from "./liveEvents.ts";

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

