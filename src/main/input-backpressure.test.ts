import assert from "node:assert/strict";
import test from "node:test";
import { shouldAcceptInjectorWrite } from "./input-win.ts";

test("shouldAcceptInjectorWrite drops commands while stdin needs drain", () => {
  assert.equal(shouldAcceptInjectorWrite(false), true);
  assert.equal(shouldAcceptInjectorWrite(true), false);
});
