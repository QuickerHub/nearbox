import assert from "node:assert/strict";
import test from "node:test";
import { trackPermissionResolve } from "./permissionAsk.ts";

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

test("failed resolve clears busy so the ask stays clickable", async () => {
  const states: boolean[] = [];
  trackPermissionResolve(
    (busy) => {
      states.push(busy);
    },
    () => Promise.reject(new Error("现在没有需要确认的命令。")),
  );
  assert.deepEqual(states, [true]);
  await waitFor(() => states.length === 2 && states[1] === false);
  assert.deepEqual(states, [true, false]);
});

test("sync throw from resolve also clears busy", async () => {
  const states: boolean[] = [];
  trackPermissionResolve(
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
});

test("successful resolve keeps busy until askId swap", async () => {
  const states: boolean[] = [];
  let settled!: () => void;
  const done = new Promise<void>((resolve) => {
    settled = resolve;
  });
  trackPermissionResolve(
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
});
