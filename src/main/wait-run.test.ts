import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { waitForActiveRun } from "./wait-run.ts";

test("waitForActiveRun resolves immediately when already idle", async () => {
  const run = { id: "a", active: false };
  const result = await waitForActiveRun(run, 5_000, {
    isActive: (item) => item.active,
    onFinished: () => undefined,
    offFinished: () => undefined,
    maxWaitMs: 120_000,
  });
  assert.equal(result, run);
});

test("waitForActiveRun settles when finish races the subscribe", async () => {
  const bus = new EventEmitter();
  const run = { id: "race", active: true };
  // Finish lands right after the first isActive check inside waitForActiveRun,
  // before/while the listener is attached — the re-check must observe idle.
  const pending = waitForActiveRun(run, 30_000, {
    isActive: (item) => item.active,
    onFinished: (listener) => {
      bus.on("run-finished", listener);
      run.active = false;
      bus.emit("run-finished", run);
    },
    offFinished: (listener) => bus.off("run-finished", listener),
    maxWaitMs: 120_000,
  });
  const result = await pending;
  assert.equal(result.id, "race");
  assert.equal(bus.listenerCount("run-finished"), 0);
});

test("waitForActiveRun times out when the run stays active", async () => {
  const bus = new EventEmitter();
  const run = { id: "slow", active: true };
  const started = Date.now();
  await waitForActiveRun(run, 40, {
    isActive: (item) => item.active,
    onFinished: (listener) => bus.on("run-finished", listener),
    offFinished: (listener) => bus.off("run-finished", listener),
    maxWaitMs: 120_000,
  });
  assert.ok(Date.now() - started >= 35);
  assert.equal(bus.listenerCount("run-finished"), 0);
});
