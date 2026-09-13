import assert from "node:assert/strict";
import test from "node:test";
import { WindowsInputInjector } from "./input-win.ts";

test("dispose makes later ready() resolve false without starting", async () => {
  const injector = new WindowsInputInjector();
  injector.dispose();
  assert.equal(await injector.ready(), false);
  injector.send(["M 0 0"]);
  assert.equal(await injector.ready(), false);
});

test("dispose settles an in-flight ready() even when spawn fails", async () => {
  const injector = new WindowsInputInjector();
  const ready = injector.ready();
  injector.dispose();
  const result = await Promise.race([
    ready,
    new Promise<string>((resolve) => {
      setTimeout(() => resolve("timeout"), 3000);
    }),
  ]);
  assert.equal(result, false);
});
