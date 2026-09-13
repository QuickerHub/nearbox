import assert from "node:assert/strict";
import test from "node:test";
import { INPUT_READY_TIMEOUT_MS, WindowsInputInjector } from "./input-win.ts";

test("INPUT_READY_TIMEOUT_MS is a finite positive budget", () => {
  assert.ok(Number.isFinite(INPUT_READY_TIMEOUT_MS) && INPUT_READY_TIMEOUT_MS >= 1000);
});

test("ready() settles false when the helper never becomes ready before the timeout", async () => {
  // On non-Windows, spawn still runs against a missing powershell path and typically
  // errors quickly; use a short timeout so a wedged child cannot hang the suite.
  const injector = new WindowsInputInjector({ readyTimeoutMs: 80 });
  const result = await Promise.race([
    injector.ready(),
    new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 2000)),
  ]);
  injector.dispose();
  assert.equal(result, false);
});
