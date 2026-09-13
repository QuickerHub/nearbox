import assert from "node:assert/strict";
import test from "node:test";
import { coerceExitCode } from "./store-exit-code.ts";

test("coerceExitCode keeps finite integers and null, drops NaN/floats", () => {
  assert.equal(coerceExitCode(0), 0);
  assert.equal(coerceExitCode(1), 1);
  assert.equal(coerceExitCode(-1), -1);
  assert.equal(coerceExitCode(null), null);
  assert.equal(coerceExitCode(undefined), undefined);
  assert.equal(coerceExitCode(Number.NaN), undefined);
  assert.equal(coerceExitCode(1.5), undefined);
  assert.equal(coerceExitCode("0"), undefined);
  assert.equal(coerceExitCode(Infinity), undefined);
});
