import assert from "node:assert/strict";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import { killTree } from "./kill.ts";

function fakeChild(patch: Partial<ChildProcess> & { pid?: number | undefined; exitCode?: number | null }): ChildProcess {
  const signals: NodeJS.Signals[] = [];
  return {
    pid: patch.pid,
    exitCode: patch.exitCode ?? null,
    kill(signal?: NodeJS.Signals | number) {
      if (typeof signal === "string") {
        signals.push(signal);
      }
      return true;
    },
    get signals() {
      return signals;
    },
    ...patch,
  } as ChildProcess & { signals: NodeJS.Signals[] };
}

test("killTree is a no-op for missing, unpid'd, or already-exited children", () => {
  assert.doesNotThrow(() => killTree(null));
  assert.doesNotThrow(() => killTree(undefined));
  assert.doesNotThrow(() => killTree(fakeChild({ pid: undefined, exitCode: null })));
  const exited = fakeChild({ pid: 4242, exitCode: 0 });
  killTree(exited);
  assert.deepEqual((exited as ChildProcess & { signals: NodeJS.Signals[] }).signals, []);
});

test("killTree sends SIGTERM on non-Windows when the child is still alive", {
  skip: process.platform === "win32" ? "taskkill path" : false,
}, () => {
  const child = fakeChild({ pid: 4242, exitCode: null });
  killTree(child);
  assert.deepEqual((child as ChildProcess & { signals: NodeJS.Signals[] }).signals, ["SIGTERM"]);
});
