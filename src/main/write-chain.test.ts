import assert from "node:assert/strict";
import test from "node:test";
import { enqueueWrite } from "./write-chain.ts";

test("enqueueWrite still runs after a rejected prior write", async () => {
  const steps: string[] = [];
  const failed = enqueueWrite(Promise.resolve(), async () => {
    steps.push("fail");
    throw new Error("disk full");
  });
  await assert.rejects(failed, /disk full/);
  await enqueueWrite(failed, async () => {
    steps.push("retry");
  });
  assert.deepEqual(steps, ["fail", "retry"]);
});

test("enqueueWrite runs the first write when the prior chain is clean", async () => {
  const steps: string[] = [];
  await enqueueWrite(Promise.resolve(), async () => {
    steps.push("ok");
  });
  assert.deepEqual(steps, ["ok"]);
});

test("enqueueWrite serializes concurrent enqueues in order", async () => {
  const steps: string[] = [];
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let sawStart!: () => void;
  const started = new Promise<void>((resolve) => {
    sawStart = resolve;
  });
  const first = enqueueWrite(Promise.resolve(), async () => {
    steps.push("first-start");
    sawStart();
    await firstGate;
    steps.push("first-end");
  });
  const second = enqueueWrite(first, async () => {
    steps.push("second");
  });
  await started;
  // Second must not start until first finishes.
  assert.deepEqual(steps, ["first-start"]);
  releaseFirst();
  await second;
  assert.deepEqual(steps, ["first-start", "first-end", "second"]);
});

test("enqueueWrite recovers after several consecutive failures", async () => {
  const steps: string[] = [];
  let chain = Promise.resolve();
  for (const label of ["a", "b", "c"]) {
    chain = enqueueWrite(chain, async () => {
      steps.push(label);
      throw new Error(`fail-${label}`);
    });
    await assert.rejects(chain, new RegExp(`fail-${label}`));
  }
  await enqueueWrite(chain, async () => {
    steps.push("ok");
  });
  assert.deepEqual(steps, ["a", "b", "c", "ok"]);
});

test("enqueueWrite still rejects the caller when the write fails", async () => {
  const failed = enqueueWrite(Promise.resolve(), async () => {
    throw new Error("EIO");
  });
  await assert.rejects(failed, /EIO/);
  // Prior rejection must not poison a later enqueue.
  await enqueueWrite(failed, async () => undefined);
});
