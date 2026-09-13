import assert from "node:assert/strict";
import test from "node:test";
import {
  releasePermissionAsk,
  resetPermissionResolveForTests,
  retainPermissionAsk,
  trackPermissionResolve,
} from "./permissionAsk.ts";

function waitFor(predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > 1000) {
        reject(new Error("timed out waiting for busy clear"));
        return;
      }
      setImmediate(tick);
    };
    tick();
  });
}

test.beforeEach(() => {
  resetPermissionResolveForTests();
});

test("failed resolve clears busy so the ask stays clickable", async () => {
  retainPermissionAsk("ask-1");
  const states: boolean[] = [];
  trackPermissionResolve(
    "ask-1",
    (busy) => {
      states.push(busy);
    },
    () => Promise.reject(new Error("现在没有需要确认的命令。")),
  );
  assert.deepEqual(states, [true]);
  await waitFor(() => states.length === 2 && states[1] === false);
  assert.deepEqual(states, [true, false]);
  releasePermissionAsk("ask-1");
});

test("sync throw from resolve also clears busy", async () => {
  retainPermissionAsk("ask-2");
  const states: boolean[] = [];
  trackPermissionResolve(
    "ask-2",
    (busy) => {
      states.push(busy);
    },
    () => {
      throw new Error("network");
    },
  );
  assert.deepEqual(states, [true]);
  await waitFor(() => states.length === 2 && states[1] === false);
  assert.deepEqual(states, [true, false]);
  releasePermissionAsk("ask-2");
});

test("successful resolve keeps busy until askId swap", async () => {
  retainPermissionAsk("ask-3");
  const states: boolean[] = [];
  let settled!: () => void;
  const done = new Promise<void>((resolve) => {
    settled = resolve;
  });
  trackPermissionResolve(
    "ask-3",
    (busy) => {
      states.push(busy);
    },
    async () => {
      settled();
    },
  );
  assert.deepEqual(states, [true]);
  await done;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(states, [true]);
  releasePermissionAsk("ask-3");
});

test("a second click on the same askId does not fire resolve again", async () => {
  retainPermissionAsk("ask-dup");
  retainPermissionAsk("ask-dup");
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const a: boolean[] = [];
  const b: boolean[] = [];
  trackPermissionResolve("ask-dup", (busy) => a.push(busy), async () => {
    calls += 1;
    await gate;
  });
  trackPermissionResolve("ask-dup", (busy) => b.push(busy), async () => {
    calls += 1;
  });
  assert.deepEqual(a, [true]);
  assert.deepEqual(b, [true]);
  await waitFor(() => calls === 1);
  // One surface unmounting must not unlock a second click on the other.
  releasePermissionAsk("ask-dup");
  trackPermissionResolve("ask-dup", (busy) => b.push(busy), async () => {
    calls += 1;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  releasePermissionAsk("ask-dup");
});
