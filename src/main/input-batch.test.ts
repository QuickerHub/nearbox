import assert from "node:assert/strict";
import test from "node:test";
import { MAX_INJECT_BATCH, capInjectorBatch } from "./input-win.ts";

test("capInjectorBatch keeps only the leading ceiling of injector lines", () => {
  assert.deepEqual(capInjectorBatch([]), []);
  assert.deepEqual(capInjectorBatch(["M 0 0", "B 1 1"]), ["M 0 0", "B 1 1"]);
  const many = Array.from({ length: MAX_INJECT_BATCH + 10 }, (_, i) => `M ${i} 0`);
  const capped = capInjectorBatch(many);
  assert.equal(capped.length, MAX_INJECT_BATCH);
  assert.equal(capped[0], "M 0 0");
  assert.equal(capped[MAX_INJECT_BATCH - 1], `M ${MAX_INJECT_BATCH - 1} 0`);
  assert.deepEqual(capInjectorBatch(["M 1 1"], 0), []);
});
