import assert from "node:assert/strict";
import test from "node:test";
import { capArrayTail, capCatalogString, capRecordKeys } from "./store-collections.ts";

test("capArrayTail keeps the newest rows", () => {
  assert.deepEqual(capArrayTail([1, 2, 3, 4, 5], 3), [3, 4, 5]);
  assert.deepEqual(capArrayTail([1, 2], 5), [1, 2]);
  assert.deepEqual(capArrayTail([1, 2, 3], 0), []);
});

test("capRecordKeys drops excess entries", () => {
  const capped = capRecordKeys({ a: 1, b: 2, c: 3 }, 2);
  assert.equal(Object.keys(capped).length, 2);
  assert.equal(capRecordKeys({ a: 1 }, 5).a, 1);
});

test("capCatalogString trims and bounds", () => {
  assert.equal(capCatalogString("  grok-4  "), "grok-4");
  assert.equal(capCatalogString("x".repeat(300))?.length, 256);
  assert.equal(capCatalogString("   "), undefined);
  assert.equal(capCatalogString(1), undefined);
});
