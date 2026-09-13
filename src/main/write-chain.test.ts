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
